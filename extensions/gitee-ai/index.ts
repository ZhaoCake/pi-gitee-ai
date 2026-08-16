// Gitee AI (模力方舟) tools + provider for pi.
//
// Registers:
//   - provider "gitee-ai" with 4 LLM models (deepseek-v4-flash-0731, GLM-5.2,
//     kimi-k3, Kimi-K2.7-Code) via pi.registerProvider()
//   - 5 custom tools callable by the agent:
//       gitee_embed    → POST /v1/embeddings  (Qwen3-Embedding-4B etc.)
//       gitee_rerank   → POST /v1/rerank      (Qwen3-Reranker-4B etc.)
//       gitee_vision   → chat completions + image_url (Qwen3-VL-32B-Instruct)
//       gitee_parse    → MinerU async doc parse / OCR (MinerU2.5-Pro)
//       gitee_image    → POST /v1/images/generations (FLUX.2-klein-4B etc.)
//
// API key: read from the GITEE_AI_API_KEY environment variable at call time
// (never hard-coded, nothing to leak when this is shared as a pi package).
//
// Cheap-by-default: default models in the tools are the free or low-cost ones
// (embedding/rerank are free on Gitee). Users can pass any other model id.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createEmbeddings,
  rerank,
  chatCompletions,
  generateImage,
  imageToDataUri,
  parseDocumentMinerU,
} from "./api.js";
import { GITEE_AI_MODELS } from "./models.js";

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function jsonResult(label: string, data: unknown) {
  return textResult(`${label}:\n${JSON.stringify(data, null, 2)}`, { [label]: data });
}

export default function (pi: ExtensionAPI) {
  // ---- Provider: LLM models -------------------------------------------------
  pi.registerProvider("gitee-ai", {
    name: "Gitee AI (模力方舟)",
    baseUrl: "https://ai.gitee.com/v1",
    apiKey: "$GITEE_AI_API_KEY",
    api: "openai-completions",
    models: GITEE_AI_MODELS,
  });

  // ---- Tool 1: embedding ----------------------------------------------------
  pi.registerTool(
    defineTool({
      name: "gitee_embed",
      label: "Gitee Embedding",
      description:
        "将一段或多段文本向量化（embedding），返回数值向量。用于语义检索、RAG、相似度计算。模型默认为免费的 Qwen3-Embedding-4B，可传其他模型名（如 Qwen3-Embedding-8B、jina-clip-v2）。",
      promptSnippet: "向量化文本为 embeddings（Gitee AI，免费），用于语义搜索/RAG",
      parameters: Type.Object({
        input: Type.Union([
          Type.String({ description: "单段文本" }),
          Type.Array(Type.String({ description: "多段文本" })),
        ], { description: "要向量化的文本（单段或多段）" }),
        model: Type.Optional(
          Type.String({ description: "向量化模型名，默认 Qwen3-Embedding-4B" }),
        ),
      }),
      async execute(_id, params) {
        const input = params.input;
        const model = params.model ?? "Qwen3-Embedding-4B";
        const result = await createEmbeddings(model, input);
        const list = Array.isArray(input) ? input : [input];
        if (list.length > 1) {
          return jsonResult(
            `已向量化 ${result.data.length} 段文本（模型: ${model}，维度: ${result.data[0]?.embedding.length ?? "?"}）`,
            result.data.map((d) => ({
              index: d.index,
              dims: d.embedding.length,
              preview: d.embedding.slice(0, 8),
            })),
          );
        }
        return textResult(
          `向量（模型: ${model}，维度: ${result.data[0]?.embedding.length ?? "?"}）:\n[${result.data[0]?.embedding.join(", ")}]`,
          { embedding: result.data[0]?.embedding },
        );
      },
    }),
  );

  // ---- Tool 2: rerank -------------------------------------------------------
  pi.registerTool(
    defineTool({
      name: "gitee_rerank",
      label: "Gitee Rerank",
      description:
        "对候选文档按与 query 的相关性重排序，返回带相关性分数的排序结果。用于检索结果精排。模型默认为免费的 Qwen3-Reranker-4B，可传其他模型名（如 Qwen3-Reranker-8B）。",
      promptSnippet: "按相关性重排候选文档（Gitee AI，免费）",
      parameters: Type.Object({
        query: Type.String({ description: "查询文本" }),
        documents: Type.Array(Type.String({ description: "待重排的候选文档" })),
        top_n: Type.Optional(Type.Number({ description: "返回前 N 个（默认全部）" })),
        model: Type.Optional(
          Type.String({ description: "重排模型名，默认 Qwen3-Reranker-4B" }),
        ),
      }),
      async execute(_id, params) {
        const model = params.model ?? "Qwen3-Reranker-4B";
        const result = await rerank(model, params.query, params.documents, params.top_n);
        return jsonResult(
          `重排结果（模型: ${model}，按相关度降序）`,
          result.results.map((r) => ({
            排名: r.index + 1,
            原始序号: r.index,
            相关度: r.relevance_score.toFixed(4),
            文本: r.document?.text ?? params.documents[r.index],
          })),
        );
      },
    }),
  );

  // ---- Tool 3: vision / OCR -------------------------------------------------
  pi.registerTool(
    defineTool({
      name: "gitee_vision",
      label: "Gitee Vision/OCR",
      description:
        "用多模态视觉模型识别图片内容：OCR 提取文字、理解截图、分析图像。支持本地文件路径或 HTTP(S) 图片 URL。默认模型 Qwen3-VL-32B-Instruct。注意：仅文本模型不支持图片；如需对 PDF/文档做深度解析（公式、表格、版式）请用 gitee_parse。",
      promptSnippet: "识别图片文字/内容（OCR + 视觉理解，Gitee AI）",
      parameters: Type.Object({
        image: Type.String({ description: "图片路径（本地绝对/相对路径）或 http(s) URL" }),
        question: Type.Optional(
          Type.String({ description: "对图片的提问，默认'请详细描述图片内容并提取所有文字'" }),
        ),
        model: Type.Optional(
          Type.String({ description: "视觉模型名，默认 Qwen3-VL-32B-Instruct" }),
        ),
        max_tokens: Type.Optional(Type.Number({ description: "最大输出 token，默认 2048" })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const model = params.model ?? "Qwen3-VL-32B-Instruct";
        const isRemote = /^https?:\/\//i.test(params.image);
        let imageUrl: string;
        if (isRemote) {
          imageUrl = params.image;
        } else {
          const abs = resolve(ctx.cwd, params.image);
          const buf = await readFile(abs);
          imageUrl = imageToDataUri(abs, buf);
        }
        const result = await chatCompletions(
          model,
          [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: params.question ?? "请详细描述图片内容并提取所有文字" },
          ],
          {
            maxTokens: params.max_tokens ?? 2048,
            prompt: "你是专业的图像理解与 OCR 助手，请准确、完整地提取图片中的文字并回答用户问题。",
          },
        );
        const content = result.choices[0]?.message?.content ?? "";
        return textResult(content, {
          model,
          reasoning_content: result.choices[0]?.message?.reasoning_content,
          usage: result.usage,
        });
      },
    }),
  );

  // ---- Tool 4: MinerU document parse / OCR ----------------------------------
  pi.registerTool(
    defineTool({
      name: "gitee_parse",
      label: "Gitee Doc Parse (MinerU)",
      description:
        "高精度文档解析/OCR：用 MinerU 解析 PDF、图片、docx、pptx，输出结构化 Markdown（保留版式，支持公式、表格、多语言）。适合票据、截图、论文、扫描件、带公式的文档。默认模型 MinerU2.5-Pro。异步任务，自动轮询直到完成。",
      promptSnippet: "解析 PDF/图片/Office 文档为 Markdown（MinerU，高精度 OCR）",
      parameters: Type.Object({
        file: Type.String({ description: "文件路径（本地绝对/相对路径）。支持 pdf, png, jpg, gif, docx, pptx，≤100MB" }),
        is_ocr: Type.Optional(
          Type.Boolean({ description: "是否启用 OCR 识别图片中的文字，默认 true" }),
        ),
        formula_enable: Type.Optional(
          Type.Boolean({ description: "是否解析公式，默认 false（开启较慢）" }),
        ),
        table_enable: Type.Optional(
          Type.Boolean({ description: "是否解析表格，默认 false（开启较慢）" }),
        ),
        language: Type.Optional(
          Type.String({
            description: "文字语言以提高识别精度：ch/en/korean/japan/chinese_cht/ta/te/ka/latin/arabic/cyrillic/devanagari，默认自动",
          }),
        ),
        end_pages: Type.Optional(Type.Number({ description: "只处理前 N 页，默认全部" })),
        model: Type.Optional(
          Type.String({ description: "解析模型名，默认 MinerU2.5-Pro（亦可 MinerU2.5、PDF-Extract-Kit-1.0）" }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const model = params.model ?? "MinerU2.5-Pro";
        const abs = resolve(ctx.cwd, params.file);
        const buf = await readFile(abs);
        const result = await parseDocumentMinerU(model, abs, buf, {
          isOcr: params.is_ocr ?? true,
          formulaEnable: params.formula_enable,
          tableEnable: params.table_enable,
          language: params.language,
          endPages: params.end_pages,
        });
        if (result.segments && result.segments.length > 0) {
          const markdown = result.segments.map((s) => s.content).join("\n\n");
          return textResult(
            `解析完成（模型: ${model}${result.price !== undefined ? `，费用: ￥${result.price}${result.currency ?? ""}` : ""}）：\n\n${markdown}`,
            { taskId: result.taskId, segments: result.segments, price: result.price },
          );
        }
        if (result.error) {
          throw new Error(`MinerU 解析失败: ${result.error}`);
        }
        return textResult(`解析完成，但未返回文本内容（task_id: ${result.taskId}）`);
      },
    }),
  );

  // ---- Tool 5: image generation ---------------------------------------------
  pi.registerTool(
    defineTool({
      name: "gitee_image",
      label: "Gitee Image Gen",
      description:
        "根据文字描述生成图片（文生图）并保存到磁盘，返回文件路径。默认模型 FLUX.2-klein-4B（轻量低成本），可传其他模型名（如 FLUX.2-dev、Qwen-Image、Wan2.7）。",
      promptSnippet: "按文字描述生成图片（Gitee AI）",
      parameters: Type.Object({
        prompt: Type.String({ description: "图片内容描述（建议用英文获得最佳效果）" }),
        size: Type.Optional(Type.String({ description: "尺寸，如 1024x1024（默认）" })),
        seed: Type.Optional(Type.Number({ description: "随机种子，可复现" })),
        model: Type.Optional(Type.String({ description: "图像模型名，默认 FLUX.2-klein-4B" })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const model = params.model ?? "FLUX.2-klein-4B";
        const result = await generateImage(model, params.prompt, {
          size: params.size,
          seed: params.seed,
          responseFormat: "b64_json",
        });
        const image = result.data[0];
        if (!image?.b64_json) {
          return textResult("生成失败：未返回图片数据", { result });
        }
        // Decode base64 → detect PNG/JPEG/WebP magic bytes → save to disk.
        const buf = Buffer.from(image.b64_json, "base64");
        const hex = buf.subarray(0, 12).toString("hex");
        const ext = hex.startsWith("89504e47")
          ? "png"
          : hex.startsWith("ffd8ff")
            ? "jpg"
            : hex.startsWith("52494646") && hex.includes("57454250")
              ? "webp"
              : null;
        if (!ext) {
          return textResult("生成成功但无法识别图片格式（未保存）", {
            model,
            b64_len: buf.length,
            magic: hex.slice(0, 12),
          });
        }
        // Save into the repo-agnostic output dir under the current directory.
        const outDir = join(ctx.cwd, "gitee-images");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filePath = join(outDir, `${basename(model)}-${stamp}.${ext}`);
        await mkdir(outDir, { recursive: true });
        await writeFile(filePath, buf);
        return textResult(
          `图片已生成并保存：${filePath}\n` +
            `模型: ${model}，尺寸: ${params.size ?? "1024x1024"}，文件: ${(buf.length / 1024).toFixed(0)}KB`,
          { model, size: params.size ?? "1024x1024", filePath, bytes: buf.length },
        );
      },
    }),
  );
}