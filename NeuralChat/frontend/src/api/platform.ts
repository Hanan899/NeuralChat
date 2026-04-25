import { buildProtectedHeaders, getApiBaseUrl, readErrorMessage } from "../api";
import type { RequestNamingContext } from "../api";
import type {
  PlatformAgent,
  PlatformCollection,
  PlatformDocument,
  PlatformMcpEndpoint,
  PlatformProvider,
  PlatformRoutePreview,
  PlatformTool,
  StreamChunk,
} from "../types";

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }
  return (await response.json()) as T;
}

export async function listPlatformProviders(authToken: string, naming?: RequestNamingContext): Promise<PlatformProvider[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/providers`, { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ providers: PlatformProvider[] }>(response, "Failed to load providers.")).providers;
}

export async function createPlatformProvider(
  authToken: string,
  payload: Record<string, unknown>,
  naming?: RequestNamingContext
): Promise<PlatformProvider> {
  const response = await fetch(`${getApiBaseUrl()}/api/providers`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  return (await readJsonOrThrow<{ provider: PlatformProvider }>(response, "Failed to create provider.")).provider;
}

export async function testPlatformProvider(authToken: string, providerId: string, naming?: RequestNamingContext): Promise<Record<string, unknown>> {
  const response = await fetch(`${getApiBaseUrl()}/api/providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ result: Record<string, unknown> }>(response, "Failed to test provider.")).result;
}

export async function listPlatformTools(authToken: string, naming?: RequestNamingContext): Promise<PlatformTool[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/tools`, { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ tools: PlatformTool[] }>(response, "Failed to load tools.")).tools;
}

export async function createPlatformTool(
  authToken: string,
  payload: Record<string, unknown>,
  naming?: RequestNamingContext
): Promise<PlatformTool> {
  const response = await fetch(`${getApiBaseUrl()}/api/tools`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  return (await readJsonOrThrow<{ tool: PlatformTool }>(response, "Failed to create tool.")).tool;
}

export async function approvePlatformTool(authToken: string, toolId: string, naming?: RequestNamingContext): Promise<PlatformTool> {
  const response = await fetch(`${getApiBaseUrl()}/api/tools/${encodeURIComponent(toolId)}/approve`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ tool: PlatformTool }>(response, "Failed to approve tool.")).tool;
}

export async function listPlatformMcpEndpoints(authToken: string, naming?: RequestNamingContext): Promise<PlatformMcpEndpoint[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/mcp/endpoints`, { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ endpoints: PlatformMcpEndpoint[] }>(response, "Failed to load MCP endpoints.")).endpoints;
}

export async function createPlatformMcpEndpoint(
  authToken: string,
  payload: Record<string, unknown>,
  naming?: RequestNamingContext
): Promise<PlatformMcpEndpoint> {
  const response = await fetch(`${getApiBaseUrl()}/api/mcp/endpoints`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  return (await readJsonOrThrow<{ endpoint: PlatformMcpEndpoint }>(response, "Failed to create MCP endpoint.")).endpoint;
}

export async function syncPlatformMcpEndpoint(
  authToken: string,
  endpointId: string,
  naming?: RequestNamingContext
): Promise<{ endpoint: PlatformMcpEndpoint; tools: PlatformTool[] }> {
  const response = await fetch(`${getApiBaseUrl()}/api/mcp/endpoints/${encodeURIComponent(endpointId)}/sync`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return readJsonOrThrow(response, "Failed to sync MCP endpoint.");
}

export async function listPlatformCollections(authToken: string, naming?: RequestNamingContext): Promise<PlatformCollection[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/collections`, { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ collections: PlatformCollection[] }>(response, "Failed to load collections.")).collections;
}

export async function createPlatformCollection(
  authToken: string,
  payload: Record<string, unknown>,
  naming?: RequestNamingContext
): Promise<PlatformCollection> {
  const response = await fetch(`${getApiBaseUrl()}/api/collections`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  return (await readJsonOrThrow<{ collection: PlatformCollection }>(response, "Failed to create collection.")).collection;
}

export async function listPlatformDocuments(
  authToken: string,
  collectionId?: string,
  naming?: RequestNamingContext
): Promise<PlatformDocument[]> {
  const url = new URL(`${getApiBaseUrl()}/api/documents`);
  if (collectionId) {
    url.searchParams.set("collection_id", collectionId);
  }
  const response = await fetch(url.toString(), { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ documents: PlatformDocument[] }>(response, "Failed to load documents.")).documents;
}

export async function uploadPlatformDocument(
  authToken: string,
  collectionId: string,
  file: File,
  naming?: RequestNamingContext
): Promise<PlatformDocument> {
  const body = new FormData();
  body.append("collection_id", collectionId);
  body.append("file", file);
  const response = await fetch(`${getApiBaseUrl()}/api/documents`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
    body,
  });
  return (await readJsonOrThrow<{ document: PlatformDocument }>(response, "Failed to upload document.")).document;
}

export async function processPlatformDocumentNow(
  authToken: string,
  documentId: string,
  naming?: RequestNamingContext
): Promise<Record<string, unknown>> {
  const response = await fetch(`${getApiBaseUrl()}/api/documents/${encodeURIComponent(documentId)}/process-now`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ result: Record<string, unknown> }>(response, "Failed to process document.")).result;
}

export async function listPlatformAgents(authToken: string, naming?: RequestNamingContext): Promise<PlatformAgent[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents`, { headers: buildProtectedHeaders(authToken, naming) });
  return (await readJsonOrThrow<{ agents: PlatformAgent[] }>(response, "Failed to load agents.")).agents;
}

export async function createPlatformAgent(
  authToken: string,
  payload: Record<string, unknown>,
  naming?: RequestNamingContext
): Promise<PlatformAgent> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  return (await readJsonOrThrow<{ agent: PlatformAgent }>(response, "Failed to create agent.")).agent;
}

export async function submitPlatformAgent(authToken: string, agentId: string, naming?: RequestNamingContext): Promise<PlatformAgent> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents/${encodeURIComponent(agentId)}/submit`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ agent: PlatformAgent }>(response, "Failed to submit agent.")).agent;
}

export async function approvePlatformAgent(authToken: string, agentId: string, naming?: RequestNamingContext): Promise<PlatformAgent> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents/${encodeURIComponent(agentId)}/approve`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ agent: PlatformAgent }>(response, "Failed to approve agent.")).agent;
}

export async function archivePlatformAgent(authToken: string, agentId: string, naming?: RequestNamingContext): Promise<PlatformAgent> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents/${encodeURIComponent(agentId)}/archive`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  return (await readJsonOrThrow<{ agent: PlatformAgent }>(response, "Failed to archive agent.")).agent;
}

export async function previewPlatformRoute(
  authToken: string,
  message: string,
  naming?: RequestNamingContext
): Promise<PlatformRoutePreview> {
  const response = await fetch(`${getApiBaseUrl()}/api/router/preview`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify({ message }),
  });
  return (await readJsonOrThrow<{ route: PlatformRoutePreview }>(response, "Failed to preview route.")).route;
}

export async function runPlatformAgentTest(
  authToken: string,
  agentId: string,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  naming?: RequestNamingContext
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/agents/${encodeURIComponent(agentId)}/test-run`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to run agent test."));
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming is not supported in this browser.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onChunk(JSON.parse(line) as StreamChunk);
    }
  }
  if (buffer.trim()) {
    onChunk(JSON.parse(buffer) as StreamChunk);
  }
}
