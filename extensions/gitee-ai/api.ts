// Gitee AI (模力方舟) HTTP client — encapsulates the OpenAI-compatible
// serverless API endpoints. All endpoints verified live on 2026-08 against
// https://ai.gitee.com/v1 with a real token.
//
// Verified capabilities:
//   POST /v1/embeddings          → OpenAI-format embeddings (Qwen3-Embedding-4B)
//   POST /v1/rerank              → docs + relevance_score (Qwen3-Reranker-4B)
//   POST /v1/chat/completions    → vision/OCR via image_url (Qwen3-VL-32B-Instruct)
//   POST /v1/images/generations  → image gen (FLUX.2-klein-4B)
//   POST /v1/images/edits        → image editing (401 verified, model pending)
//   POST /v1/audio/speech        → TTS (401 verified)
//   POST /v1/images/ocr          → dedicated OCR endpoint: currently all models
//                                  "deactivated or unsupported" — do NOT use;
//                                  use chat completions + Qwen3-VL instead.
//
// The key is resolved from the GITEE_AI_API_KEY environment variable at call
// time, so it can be injected by the parent (pi) process or user shell.

import { basename } from "node:path";

export const GITEE_BASE_URL = "https://ai.gitee.com/v1";

export function giteeApiKey(): string {
  const key = process.env.GITEE_AI_API_KEY;
  if (!key || key === "这里填入你的令牌") {
    throw new Error(
      "GITEE_AI_API_KEY 未配置。请在 ~/.config/fish/config.fish（或环境变量）中设置模力方舟访问令牌。",
    );
  }
  return key;
}

async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs = 120_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GITEE_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${giteeApiKey()}`,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
      } catch {
        detail = (await res.text()).slice(0, 300);
      }
      throw new Error(`Gitee AI ${path} 请求失败 (${res.status}): ${detail}`);
    }
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gitee AI ${path} 请求超时（${timeoutMs / 1000}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export interface EmbeddingResult {
  data: { embedding: number[]; index: number }[];
  usage?: { totalTokens?: number; promptTokens?: number };
}

/** POST /v1/embeddings — OpenAI-compatible. */
export async function createEmbeddings(
  model: string,
  input: string | string[],
): Promise<EmbeddingResult> {
  return postJson<EmbeddingResult>("/embeddings", { model, input });
}

export interface RerankResult {
  model: string;
  usage?: { totalTokens?: number; promptTokens?: number };
  results: {
    index: number;
    relevance_score: number;
    document?: { text: string };
  }[];
}

/** POST /v1/rerank — returns documents reordered by relevance_score desc. */
export async function rerank(
  model: string,
  query: string,
  documents: string[],
  topN?: number,
): Promise<RerankResult> {
  return postJson<RerankResult>("/rerank", { model, query, documents, top_n: topN });
}

export interface ChatMessagePart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatCompletionResult {
  choices: {
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }[];
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

/** POST /v1/chat/completions — used for vision/OCR (image_url) and TTS-free text. */
export async function chatCompletions(
  model: string,
  parts: ChatMessagePart[],
  opts: { maxTokens?: number; prompt?: string } = {},
): Promise<ChatCompletionResult> {
  const messages = [
    ...(opts.prompt ? [{ role: "system" as const, content: opts.prompt }] : []),
    { role: "user" as const, content: parts },
  ];
  return postJson<ChatCompletionResult>("/chat/completions", {
    model,
    messages,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
}

export interface ImageGenOptions {
  size?: string;
  seed?: number;
  responseFormat?: "b64_json" | "url";
}

export interface ImageGenResult {
  data: { b64_json?: string; url?: string; revised_prompt?: string }[];
  created?: number;
}

/** POST /v1/images/generations. */
export async function generateImage(
  model: string,
  prompt: string,
  opts: ImageGenOptions = {},
): Promise<ImageGenResult> {
  return postJson<ImageGenResult>("/images/generations", {
    model,
    prompt,
    size: opts.size ?? "1024x1024",
    response_format: opts.responseFormat ?? "b64_json",
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
}

/** Convert a local image file to a data URI for vision/OCR calls. */
export function imageToDataUri(filePath: string, buffer: Uint8Array): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "png";
  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };
  const b64 = Buffer.from(buffer).toString("base64");
  return `data:${mime[ext] ?? "image/png"};base64,${b64}`;
}

// ---- MinerU document parsing (async task API) ------------------------------
//
// Docs: https://ai.gitee.com/docs/products/apis/documents/pdf
// Flow (all verified live):
//   1. POST /v1/async/documents/parse  (multipart form; model + file + flags)
//      → { task_id, status: "waiting", urls: { get, cancel } }
//   2. Poll GET {urls.get} (NB: host path is /api/v1/task/<id>, not /v1/task)
//      until status === "success" | "failed" | "error".
//   3. output.segments[].content is markdown.
// Supported files: pdf, png, jpg, gif, docx, pptx (≤100MB).

export interface MinerUParseOptions {
  isOcr?: boolean;
  formulaEnable?: boolean;
  tableEnable?: boolean;
  layoutModel?: "doclayout_yolo" | "layoutlmv3";
  language?: string;
  endPages?: number;
  includeImageBase64?: boolean;
  pollIntervalMs?: number;
  maxPollSeconds?: number;
}

export interface MinerUParseResult {
  taskId: string;
  status: string;
  price?: number;
  currency?: string;
  segments?: { index: number; content: string }[];
  error?: string;
}

function mimeTypeFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Submit a document/image to MinerU and block until parsing completes. */
export async function parseDocumentMinerU(
  model: string,
  filePath: string,
  fileBuffer: Uint8Array,
  opts: MinerUParseOptions = {},
): Promise<MinerUParseResult> {
  const form = new FormData();
  form.append("model", model);
  if (opts.isOcr !== undefined) form.append("is_ocr", String(opts.isOcr));
  if (opts.formulaEnable !== undefined) form.append("formula_enable", String(opts.formulaEnable));
  if (opts.tableEnable !== undefined) form.append("table_enable", String(opts.tableEnable));
  if (opts.layoutModel) form.append("layout_model", opts.layoutModel);
  if (opts.language) form.append("language", opts.language);
  if (opts.endPages !== undefined) form.append("end_pages", String(opts.endPages));
  if (opts.includeImageBase64 !== undefined)
    form.append("include_image_base64", String(opts.includeImageBase64));
  form.append("file", new Blob([fileBuffer], { type: mimeTypeFor(filePath) }), basename(filePath));

  const submit = await request("/async/documents/parse", {
    method: "POST",
    body: form,
  });
  const submitted = (await submit.json()) as {
    task_id?: string;
    status?: string;
    urls?: { get?: string };
    error?: { message?: string };
  };
  const taskId = submitted.task_id;
  if (!taskId) {
    throw new Error(`MinerU 任务提交失败: ${submitted.error?.message ?? JSON.stringify(submitted).slice(0, 300)}`);
  }

  const pollUrl = submitted.urls?.get;
  const interval = opts.pollIntervalMs ?? 3000;
  const startedAt = Date.now();
  const deadline = startedAt + (opts.maxPollSeconds ?? 180) * 1000;
  while (true) {
    const res = await fetch(pollUrl ?? `${GITEE_BASE_URL}/async/task/${taskId}`, {
      headers: { Authorization: `Bearer ${giteeApiKey()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`MinerU 任务查询失败 (${res.status})`);
    }
    const state = (await res.json()) as {
      status?: string;
      task_id?: string;
      output?: {
        segments?: { index: number; content: string }[];
        error?: string;
      };
      price?: number;
      currency?: string;
      error?: { message?: string };
    };

    // Terminal failure — Gitee's server returns output.error with an empty
    // status field instead of status: "failed"/"error". Treat it as failure.
    if (state.output?.error || state.error?.message || state.status === "failed" || state.status === "error") {
      return {
        taskId,
        status: "failed",
        error: state.output?.error ?? state.error?.message ?? state.status,
      };
    }
    if (state.status === "success") {
      return {
        taskId,
        status: "success",
        price: state.price,
        currency: state.currency,
        segments: state.output?.segments ?? [],
      };
    }
    if (state.status === "failed" || state.status === "error") {
      return { taskId, status: state.status, error: state.error?.message ?? state.output?.error };
    }
    // Stuck in "waiting"/empty status longer than a few seconds with no
    // output and no progress often means the server-side job died silently.
    if ((!state.status || state.status === "waiting") && Date.now() - startedAt > 15_000) {
      return { taskId, status: "failed", error: "服务端任务无进展（可能内部错误），请重试" };
    }
    if (Date.now() > deadline) {
      throw new Error(`MinerU 解析超时（${(opts.maxPollSeconds ?? 180)}s），task_id=${taskId}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}