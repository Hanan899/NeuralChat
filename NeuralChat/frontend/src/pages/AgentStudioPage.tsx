import { FormEvent, useEffect, useMemo, useState } from "react";

import type { RequestNamingContext } from "../api";
import {
  approvePlatformAgent,
  approvePlatformTool,
  createPlatformAgent,
  createPlatformCollection,
  createPlatformMcpEndpoint,
  createPlatformProvider,
  createPlatformTool,
  listPlatformAgents,
  listPlatformCollections,
  listPlatformDocuments,
  listPlatformMcpEndpoints,
  listPlatformProviders,
  listPlatformTools,
  previewPlatformRoute,
  processPlatformDocumentNow,
  runPlatformAgentTest,
  submitPlatformAgent,
  syncPlatformMcpEndpoint,
  testPlatformProvider,
  uploadPlatformDocument,
} from "../api/platform";
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

type StudioTab = "providers" | "tools" | "mcp" | "collections" | "agents" | "router";

interface AgentStudioPageProps {
  authToken: string;
  naming: RequestNamingContext;
  isOwner: boolean;
  onShowToast?: (message: string, tone?: "success" | "info" | "error") => void;
}

interface StudioTabDefinition {
  id: StudioTab;
  label: string;
  detail: string;
}

const TABS: StudioTabDefinition[] = [
  { id: "providers", label: "Providers", detail: "Models and credentials" },
  { id: "tools", label: "Tools", detail: "HTTP capabilities" },
  { id: "mcp", label: "MCP", detail: "Remote endpoint sync" },
  { id: "collections", label: "Collections", detail: "Uploads and indexing" },
  { id: "agents", label: "Dynamic agents", detail: "Drafts, approvals, tests" },
  { id: "router", label: "Router", detail: "Routing preview" },
];

function AgentStudioIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5" width="7" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13" y="5" width="7" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="8.5" y="13" width="7" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11 8H13M12 11V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function StudioEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="nc-agent-studio__empty">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "Not available yet";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString();
}

function formatRouteTarget(routePreview: PlatformRoutePreview | null): string {
  if (!routePreview) {
    return "Preview a sample prompt to inspect how the router classifies it.";
  }

  if (routePreview.target_kind === "dynamic_agent" && routePreview.target_id) {
    return `Routed to dynamic agent ${routePreview.target_id}.`;
  }

  if (routePreview.target_kind === "documents") {
    return "Routed to the document-grounded path.";
  }

  return "Routed to the general chat path.";
}

function getActiveTabSpotlight(
  activeTab: StudioTab,
  providers: PlatformProvider[],
  tools: PlatformTool[],
  mcpEndpoints: PlatformMcpEndpoint[],
  collections: PlatformCollection[],
  documents: PlatformDocument[],
  agents: PlatformAgent[],
) {
  if (activeTab === "providers") {
    const enabledCount = providers.filter((provider) => provider.enabled).length;
    return {
      title: `${enabledCount} active provider${enabledCount === 1 ? "" : "s"}`,
      description: "Keep model credentials, defaults, and deployment settings aligned with the same workspace design as the rest of NeuralChat.",
    };
  }

  if (activeTab === "tools") {
    const approvedCount = tools.filter((tool) => tool.approval_status === "approved").length;
    return {
      title: `${approvedCount} approved tool${approvedCount === 1 ? "" : "s"}`,
      description: "Review capability status quickly, then promote only the tools that are ready for shared agent workflows.",
    };
  }

  if (activeTab === "mcp") {
    return {
      title: `${mcpEndpoints.length} remote endpoint${mcpEndpoints.length === 1 ? "" : "s"}`,
      description: "Sync MCP servers into the platform without leaving the existing NeuralChat shell.",
    };
  }

  if (activeTab === "collections") {
    const readyCount = documents.filter((document) => document.status === "ready").length;
    return {
      title: `${readyCount} indexed document${readyCount === 1 ? "" : "s"}`,
      description: "Collections stay grounded in your uploaded workspace data, with owner-triggered processing available when needed.",
    };
  }

  if (activeTab === "agents") {
    const submittedCount = agents.filter((agent) => agent.status !== "draft").length;
    return {
      title: `${submittedCount} staged agent${submittedCount === 1 ? "" : "s"}`,
      description: "Draft, submit, approve, and test dynamic agents from the same polished workflow language used across projects.",
    };
  }

  return {
    title: `${collections.length} collection${collections.length === 1 ? "" : "s"} and ${agents.length} agent${agents.length === 1 ? "" : "s"}`,
    description: "Use routing previews to sanity-check when prompts should stay general, pull from documents, or switch into a dynamic agent.",
  };
}

export function AgentStudioPage({ authToken, naming, isOwner, onShowToast }: AgentStudioPageProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>("providers");
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [providers, setProviders] = useState<PlatformProvider[]>([]);
  const [tools, setTools] = useState<PlatformTool[]>([]);
  const [mcpEndpoints, setMcpEndpoints] = useState<PlatformMcpEndpoint[]>([]);
  const [collections, setCollections] = useState<PlatformCollection[]>([]);
  const [documents, setDocuments] = useState<PlatformDocument[]>([]);
  const [agents, setAgents] = useState<PlatformAgent[]>([]);
  const [routePreview, setRoutePreview] = useState<PlatformRoutePreview | null>(null);
  const [routePrompt, setRoutePrompt] = useState("");
  const [providerTestOutput, setProviderTestOutput] = useState<Record<string, unknown> | null>(null);
  const [agentTestOutput, setAgentTestOutput] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("Summarize what this agent is configured to do.");

  const [providerForm, setProviderForm] = useState({
    provider_key: "azure_openai",
    display_name: "Azure OpenAI",
    default_chat_model: "gpt-5-chat",
    default_embedding_model: "text-embedding-3-large",
    base_url: "",
    api_key: "",
    deployment: "",
  });
  const [toolForm, setToolForm] = useState({
    name: "Status API",
    url: "https://example.com/api/status",
    method: "GET",
    schemaText: '{"type":"object","properties":{"id":{"type":"string"}}}',
  });
  const [mcpForm, setMcpForm] = useState({
    name: "Remote MCP",
    endpoint_url: "https://example.com/mcp",
  });
  const [collectionForm, setCollectionForm] = useState({
    name: "Support Docs",
    description: "Workspace knowledge base",
  });
  const [agentForm, setAgentForm] = useState({
    name: "Docs Analyst",
    description: "Routes document-heavy questions through a focused system prompt.",
    model_id: "gpt-5",
    system_prompt: "You are a precise workspace agent. Prefer grounded answers and cite available collection context.",
  });

  const activeTabDefinition = useMemo(
    () => TABS.find((tab) => tab.id === activeTab) ?? TABS[0],
    [activeTab],
  );

  const selectedCollectionDocuments = useMemo(
    () => documents.filter((document) => !selectedCollectionId || document.collection_id === selectedCollectionId),
    [documents, selectedCollectionId],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );

  const approvedToolsCount = useMemo(
    () => tools.filter((tool) => tool.approval_status === "approved").length,
    [tools],
  );

  const readyDocumentsCount = useMemo(
    () => documents.filter((document) => document.status === "ready").length,
    [documents],
  );

  const activeProviderCount = useMemo(
    () => providers.filter((provider) => provider.enabled).length,
    [providers],
  );

  const spotlight = useMemo(
    () => getActiveTabSpotlight(activeTab, providers, tools, mcpEndpoints, collections, documents, agents),
    [activeTab, providers, tools, mcpEndpoints, collections, documents, agents],
  );

  async function runStudioAction(
    action: () => Promise<void>,
    fallbackMessage: string,
    successMessage?: string,
  ) {
    setErrorText("");
    try {
      await action();
      if (successMessage) {
        onShowToast?.(successMessage, "success");
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : fallbackMessage);
    }
  }

  async function refreshAll() {
    setIsLoading(true);
    setErrorText("");

    try {
      const [nextProviders, nextTools, nextEndpoints, nextCollections, nextDocuments, nextAgents] = await Promise.all([
        listPlatformProviders(authToken, naming),
        listPlatformTools(authToken, naming),
        listPlatformMcpEndpoints(authToken, naming),
        listPlatformCollections(authToken, naming),
        listPlatformDocuments(authToken, undefined, naming),
        listPlatformAgents(authToken, naming),
      ]);

      setProviders(nextProviders);
      setTools(nextTools);
      setMcpEndpoints(nextEndpoints);
      setCollections(nextCollections);
      setDocuments(nextDocuments);
      setAgents(nextAgents);
      setSelectedCollectionId((currentValue) => {
        if (currentValue && nextCollections.some((collection) => collection.id === currentValue)) {
          return currentValue;
        }
        return nextCollections[0]?.id ?? "";
      });
      setSelectedAgentId((currentValue) => {
        if (currentValue && nextAgents.some((agent) => agent.id === currentValue)) {
          return currentValue;
        }
        return nextAgents[0]?.id ?? "";
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unable to load Agent Studio.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!authToken) {
      return;
    }

    void refreshAll();
  }, [authToken]);

  async function handleCreateProvider(event: FormEvent) {
    event.preventDefault();
    await runStudioAction(
      async () => {
        await createPlatformProvider(
          authToken,
          {
            provider_key: providerForm.provider_key,
            display_name: providerForm.display_name,
            is_default_chat: true,
            base_url: providerForm.base_url,
            default_chat_model: providerForm.default_chat_model,
            default_embedding_model: providerForm.default_embedding_model,
            credentials: {
              api_key: providerForm.api_key,
              deployment: providerForm.deployment,
              endpoint: providerForm.base_url,
            },
          },
          naming,
        );
        await refreshAll();
      },
      "Unable to save provider.",
      "Provider saved.",
    );
  }

  async function handleCreateTool(event: FormEvent) {
    event.preventDefault();
    await runStudioAction(
      async () => {
        await createPlatformTool(
          authToken,
          {
            name: toolForm.name,
            url: toolForm.url,
            method: toolForm.method,
            input_schema: JSON.parse(toolForm.schemaText || "{}"),
          },
          naming,
        );
        await refreshAll();
      },
      "Unable to save tool.",
      "Tool saved.",
    );
  }

  async function handleCreateMcp(event: FormEvent) {
    event.preventDefault();
    await runStudioAction(
      async () => {
        await createPlatformMcpEndpoint(authToken, mcpForm, naming);
        await refreshAll();
      },
      "Unable to save MCP endpoint.",
      "MCP endpoint saved.",
    );
  }

  async function handleCreateCollection(event: FormEvent) {
    event.preventDefault();
    await runStudioAction(
      async () => {
        await createPlatformCollection(authToken, collectionForm, naming);
        await refreshAll();
      },
      "Unable to save collection.",
      "Collection saved.",
    );
  }

  async function handleCreateAgent(event: FormEvent) {
    event.preventDefault();
    await runStudioAction(
      async () => {
        await createPlatformAgent(
          authToken,
          {
            ...agentForm,
            collection_ids: selectedCollectionId ? [selectedCollectionId] : [],
            tool_ids: [],
          },
          naming,
        );
        await refreshAll();
      },
      "Unable to save agent.",
      "Agent draft saved.",
    );
  }

  async function handlePreviewRoute() {
    setErrorText("");
    try {
      const preview = await previewPlatformRoute(authToken, routePrompt, naming);
      setRoutePreview(preview);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unable to preview route.");
    }
  }

  async function handleRunAgentTest() {
    if (!selectedAgentId) {
      setErrorText("Choose an agent before running a test.");
      return;
    }

    setErrorText("");
    setAgentTestOutput("");

    try {
      await runPlatformAgentTest(
        authToken,
        selectedAgentId,
        agentPrompt,
        (chunk: StreamChunk) => {
          if (chunk.type === "token") {
            setAgentTestOutput((previous) => previous + chunk.content);
          }
          if (chunk.type === "error") {
            setErrorText(chunk.content || "Agent test run failed.");
          }
        },
        naming,
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unable to run agent test.");
    }
  }

  async function handleTestProvider(providerId: string) {
    setErrorText("");
    try {
      const result = await testPlatformProvider(authToken, providerId, naming);
      setProviderTestOutput(result);
      onShowToast?.("Provider test completed.", "success");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unable to test provider.");
    }
  }

  return (
    <section className="nc-agent-studio" data-testid="agent-studio-page">
      <header className="nc-agent-studio__header">
        <div className="nc-agent-studio__header-copy">
          <div className="nc-agent-studio__title-row">
            <span className="nc-agent-studio__icon" aria-hidden="true">
              <AgentStudioIcon />
            </span>
            <div>
              <p className="nc-agent-studio__eyebrow">Agent Studio</p>
              <h2>Dynamic Agent Studio</h2>
            </div>
          </div>

          <div className="nc-agent-studio__meta-row">
            <span className="nc-agent-studio__badge">Shared NeuralChat workspace styling</span>
            <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">
              {isOwner ? "Owner approvals enabled" : "Workspace view"}
            </span>
            {isLoading ? (
              <span className="nc-agent-studio__badge nc-agent-studio__badge--status">Refreshing…</span>
            ) : null}
          </div>

          <p className="nc-agent-studio__summary">
            Configure providers, tools, collections, routing, and dynamic agents inside the same frontend language your
            existing project workspace already uses.
          </p>

          <div className="nc-agent-studio__workspace-note">
            <span>{providers.length} provider{providers.length === 1 ? "" : "s"}</span>
            <span>{tools.length} tool{tools.length === 1 ? "" : "s"}</span>
            <span>{collections.length} collection{collections.length === 1 ? "" : "s"}</span>
            <span>{agents.length} dynamic agent{agents.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div className="nc-agent-studio__header-actions">
          <div className="nc-agent-studio__spotlight">
            <p className="nc-agent-studio__spotlight-eyebrow">{activeTabDefinition.label}</p>
            <strong>{spotlight.title}</strong>
            <p>{spotlight.description}</p>
          </div>
          <button type="button" className="nc-button nc-button--primary" onClick={() => void refreshAll()}>
            Refresh Studio
          </button>
        </div>
      </header>

      {errorText ? <div className="nc-agent-studio__alert">{errorText}</div> : null}

      <div className="nc-agent-studio__stats">
        <article className="nc-agent-studio__stat-card">
          <span className="nc-agent-studio__stat-label">Providers</span>
          <strong>{activeProviderCount}</strong>
          <p>{providers.length} configured in total</p>
        </article>
        <article className="nc-agent-studio__stat-card">
          <span className="nc-agent-studio__stat-label">Tools</span>
          <strong>{approvedToolsCount}</strong>
          <p>Approved for shared use</p>
        </article>
        <article className="nc-agent-studio__stat-card">
          <span className="nc-agent-studio__stat-label">Documents</span>
          <strong>{readyDocumentsCount}</strong>
          <p>Indexed and ready to ground answers</p>
        </article>
        <article className="nc-agent-studio__stat-card">
          <span className="nc-agent-studio__stat-label">Agents</span>
          <strong>{agents.length}</strong>
          <p>Drafted or published dynamic agents</p>
        </article>
      </div>

      <div className="nc-agent-studio__tabs" role="tablist" aria-label="Agent Studio sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`nc-agent-studio__tab ${activeTab === tab.id ? "nc-agent-studio__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <span>{tab.detail}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <section className="nc-project-panel nc-agent-studio__surface">
          <StudioEmptyState
            title="Loading Agent Studio"
            description="Pulling providers, tools, collections, and dynamic agents from the platform backend."
          />
        </section>
      ) : null}

      {!isLoading && activeTab === "providers" ? (
        <div className="nc-agent-studio__grid">
          <form className="nc-project-panel nc-agent-studio__surface" onSubmit={handleCreateProvider}>
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Connection setup</p>
                <h3>Provider registry</h3>
                <p>Store the model endpoint, deployment, and default model settings your dynamic agents should rely on.</p>
              </div>
            </div>

            <div className="nc-agent-studio__form-grid">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Provider key</span>
                <input
                  value={providerForm.provider_key}
                  onChange={(event) => setProviderForm((previous) => ({ ...previous, provider_key: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Display name</span>
                <input
                  value={providerForm.display_name}
                  onChange={(event) => setProviderForm((previous) => ({ ...previous, display_name: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Base URL</span>
                <input
                  value={providerForm.base_url}
                  onChange={(event) => setProviderForm((previous) => ({ ...previous, base_url: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Deployment</span>
                <input
                  value={providerForm.deployment}
                  onChange={(event) => setProviderForm((previous) => ({ ...previous, deployment: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Default chat model</span>
                <input
                  value={providerForm.default_chat_model}
                  onChange={(event) =>
                    setProviderForm((previous) => ({ ...previous, default_chat_model: event.target.value }))
                  }
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Default embedding model</span>
                <input
                  value={providerForm.default_embedding_model}
                  onChange={(event) =>
                    setProviderForm((previous) => ({ ...previous, default_embedding_model: event.target.value }))
                  }
                />
              </label>
              <label className="nc-project-field nc-agent-studio__field-span-full">
                <span className="nc-project-field__label">API key</span>
                <input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(event) => setProviderForm((previous) => ({ ...previous, api_key: event.target.value }))}
                />
              </label>
            </div>

            <div className="nc-agent-studio__panel-actions">
              <button type="submit" className="nc-button nc-button--primary">
                Save provider
              </button>
            </div>
          </form>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Live registry</p>
                <h3>Configured providers</h3>
                <p>Review defaults, enabled state, and connection health at a glance.</p>
              </div>
            </div>

            {providers.length === 0 ? (
              <StudioEmptyState
                title="No providers configured yet"
                description="Add your first provider to give the platform a live chat and embeddings endpoint."
              />
            ) : (
              <div className="nc-agent-studio__stack">
                {providers.map((provider) => (
                  <article key={provider.id} className="nc-agent-studio__item-card">
                    <div className="nc-agent-studio__item-copy">
                      <div className="nc-agent-studio__item-heading">
                        <strong>{provider.display_name}</strong>
                        <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">
                          {provider.enabled ? "Enabled" : "Disabled"}
                        </span>
                        {provider.is_default_chat ? <span className="nc-agent-studio__badge">Default chat</span> : null}
                        {provider.is_default_embeddings ? (
                          <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">Default embeddings</span>
                        ) : null}
                      </div>
                      <p>{provider.provider_key}</p>
                      <div className="nc-agent-studio__item-meta">
                        <span>{provider.default_chat_model || "No default chat model"}</span>
                        <span>{provider.default_embedding_model || "No embedding model"}</span>
                        {provider.base_url ? <span>{provider.base_url}</span> : null}
                      </div>
                    </div>

                    <div className="nc-agent-studio__item-actions">
                      <button
                        type="button"
                        className="nc-button nc-button--ghost"
                        onClick={() => void handleTestProvider(provider.id)}
                      >
                        Test connection
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {providerTestOutput ? (
              <div className="nc-agent-studio__result">
                <div className="nc-agent-studio__result-head">
                  <strong>Latest provider test</strong>
                  <span>Most recent output</span>
                </div>
                <pre className="nc-agent-studio__code">{JSON.stringify(providerTestOutput, null, 2)}</pre>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {!isLoading && activeTab === "tools" ? (
        <div className="nc-agent-studio__grid">
          <form className="nc-project-panel nc-agent-studio__surface" onSubmit={handleCreateTool}>
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Capability design</p>
                <h3>HTTP tool registry</h3>
                <p>Define external actions in the same clean workspace language your existing product already uses.</p>
              </div>
            </div>

            <div className="nc-agent-studio__form-grid">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Name</span>
                <input
                  value={toolForm.name}
                  onChange={(event) => setToolForm((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Method</span>
                <input
                  value={toolForm.method}
                  onChange={(event) => setToolForm((previous) => ({ ...previous, method: event.target.value }))}
                />
              </label>
              <label className="nc-project-field nc-agent-studio__field-span-full">
                <span className="nc-project-field__label">URL</span>
                <input
                  value={toolForm.url}
                  onChange={(event) => setToolForm((previous) => ({ ...previous, url: event.target.value }))}
                />
              </label>
              <label className="nc-project-field nc-agent-studio__field-span-full">
                <span className="nc-project-field__label">JSON schema</span>
                <textarea
                  className="nc-project-field__textarea"
                  rows={6}
                  value={toolForm.schemaText}
                  onChange={(event) => setToolForm((previous) => ({ ...previous, schemaText: event.target.value }))}
                />
              </label>
            </div>

            <div className="nc-agent-studio__panel-actions">
              <button type="submit" className="nc-button nc-button--primary">
                Save tool
              </button>
            </div>
          </form>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Approval workflow</p>
                <h3>Available tools</h3>
                <p>Track which tools are approved, which are still draft, and which ones still need owner review.</p>
              </div>
            </div>

            {tools.length === 0 ? (
              <StudioEmptyState
                title="No tools staged yet"
                description="Create your first HTTP tool and it will appear here with approval state and retry settings."
              />
            ) : (
              <div className="nc-agent-studio__stack">
                {tools.map((tool) => (
                  <article key={tool.id} className="nc-agent-studio__item-card">
                    <div className="nc-agent-studio__item-copy">
                      <div className="nc-agent-studio__item-heading">
                        <strong>{tool.name}</strong>
                        <span className="nc-agent-studio__badge">{tool.kind}</span>
                        <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">{tool.approval_status}</span>
                      </div>
                      <p>{tool.description?.trim() || tool.url || "No description provided yet."}</p>
                      <div className="nc-agent-studio__item-meta">
                        <span>{tool.method || "Method unset"}</span>
                        <span>{tool.timeout_seconds}s timeout</span>
                        <span>{tool.retry_limit} retries</span>
                      </div>
                    </div>

                    <div className="nc-agent-studio__item-actions">
                      {isOwner && tool.approval_status !== "approved" ? (
                        <button
                          type="button"
                          className="nc-button nc-button--ghost"
                          onClick={() =>
                            void runStudioAction(
                              async () => {
                                await approvePlatformTool(authToken, tool.id, naming);
                                await refreshAll();
                              },
                              "Unable to approve tool.",
                              "Tool approved.",
                            )
                          }
                        >
                          Approve
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!isLoading && activeTab === "mcp" ? (
        <div className="nc-agent-studio__grid">
          <form className="nc-project-panel nc-agent-studio__surface" onSubmit={handleCreateMcp}>
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Remote sync</p>
                <h3>MCP endpoints</h3>
                <p>Register remote MCP servers so the platform can import their tools into the same unified studio.</p>
              </div>
            </div>

            <div className="nc-agent-studio__form-grid nc-agent-studio__form-grid--single">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Name</span>
                <input
                  value={mcpForm.name}
                  onChange={(event) => setMcpForm((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Endpoint URL</span>
                <input
                  value={mcpForm.endpoint_url}
                  onChange={(event) => setMcpForm((previous) => ({ ...previous, endpoint_url: event.target.value }))}
                />
              </label>
            </div>

            <div className="nc-agent-studio__panel-actions">
              <button type="submit" className="nc-button nc-button--primary">
                Save endpoint
              </button>
            </div>
          </form>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Endpoint status</p>
                <h3>Sync history</h3>
                <p>Review last sync times and retry endpoint imports without leaving the workspace.</p>
              </div>
            </div>

            {mcpEndpoints.length === 0 ? (
              <StudioEmptyState
                title="No MCP endpoints connected yet"
                description="Once you add a remote MCP server, its sync status and imported tooling history will show here."
              />
            ) : (
              <div className="nc-agent-studio__stack">
                {mcpEndpoints.map((endpoint) => (
                  <article key={endpoint.id} className="nc-agent-studio__item-card">
                    <div className="nc-agent-studio__item-copy">
                      <div className="nc-agent-studio__item-heading">
                        <strong>{endpoint.name}</strong>
                        <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">
                          {endpoint.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p>{endpoint.endpoint_url}</p>
                      <div className="nc-agent-studio__item-meta">
                        <span>Last sync: {formatTimestamp(endpoint.last_synced_at)}</span>
                        {endpoint.last_sync_error ? <span>Error: {endpoint.last_sync_error}</span> : null}
                      </div>
                    </div>

                    <div className="nc-agent-studio__item-actions">
                      <button
                        type="button"
                        className="nc-button nc-button--ghost"
                        onClick={() =>
                          void runStudioAction(
                            async () => {
                              await syncPlatformMcpEndpoint(authToken, endpoint.id, naming);
                              await refreshAll();
                            },
                            "Unable to sync MCP endpoint.",
                            "MCP endpoint synced.",
                          )
                        }
                      >
                        Sync now
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!isLoading && activeTab === "collections" ? (
        <div className="nc-agent-studio__grid">
          <form className="nc-project-panel nc-agent-studio__surface" onSubmit={handleCreateCollection}>
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Knowledge base</p>
                <h3>Document collections</h3>
                <p>Create reusable collections that dynamic agents and document routing can ground against.</p>
              </div>
            </div>

            <div className="nc-agent-studio__form-grid nc-agent-studio__form-grid--single">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Name</span>
                <input
                  value={collectionForm.name}
                  onChange={(event) => setCollectionForm((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Description</span>
                <textarea
                  className="nc-project-field__textarea"
                  rows={5}
                  value={collectionForm.description}
                  onChange={(event) =>
                    setCollectionForm((previous) => ({ ...previous, description: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="nc-agent-studio__panel-actions">
              <button type="submit" className="nc-button nc-button--primary">
                Create collection
              </button>
            </div>
          </form>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Uploads and indexing</p>
                <h3>Collection documents</h3>
                <p>Switch between collections, upload new files, and monitor indexing progress from a single card.</p>
              </div>
            </div>

            <div className="nc-agent-studio__inline-controls">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Active collection</span>
                <select value={selectedCollectionId} onChange={(event) => setSelectedCollectionId(event.target.value)}>
                  <option value="">Select a collection</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="nc-agent-studio__upload-control">
                <span className="nc-project-field__label">Add document</span>
                <label className="nc-button nc-button--ghost">
                  Upload file
                  <input
                    type="file"
                    className="nc-agent-studio__file-input"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0];
                      if (!nextFile || !selectedCollectionId) {
                        return;
                      }
                      void runStudioAction(
                        async () => {
                          await uploadPlatformDocument(authToken, selectedCollectionId, nextFile, naming);
                          await refreshAll();
                        },
                        "Unable to upload document.",
                        "Document uploaded and queued.",
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            {selectedCollection ? (
              <div className="nc-agent-studio__focus-card">
                <div className="nc-agent-studio__focus-header">
                  <div>
                    <p className="nc-agent-studio__section-kicker">Collection focus</p>
                    <strong>{selectedCollection.name}</strong>
                  </div>
                  <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">{selectedCollection.slug}</span>
                </div>
                <p>{selectedCollection.description?.trim() || "This collection does not have a description yet."}</p>
              </div>
            ) : null}

            {selectedCollectionDocuments.length === 0 ? (
              <StudioEmptyState
                title="No documents in this collection yet"
                description="Upload a file once and the platform will queue it for indexing so dynamic agents can reuse it later."
              />
            ) : (
              <div className="nc-agent-studio__stack">
                {selectedCollectionDocuments.map((document) => (
                  <article key={document.id} className="nc-agent-studio__item-card">
                    <div className="nc-agent-studio__item-copy">
                      <div className="nc-agent-studio__item-heading">
                        <strong>{document.filename}</strong>
                        <span className="nc-agent-studio__badge">{document.status}</span>
                      </div>
                      <p>{document.error_message?.trim() || document.blob_path}</p>
                      <div className="nc-agent-studio__item-meta">
                        <span>{document.chunk_count} chunk{document.chunk_count === 1 ? "" : "s"}</span>
                        <span>{document.size_bytes} bytes</span>
                        <span>Indexed: {formatTimestamp(document.indexed_at)}</span>
                      </div>
                    </div>

                    <div className="nc-agent-studio__item-actions">
                      {isOwner ? (
                        <button
                          type="button"
                          className="nc-button nc-button--ghost"
                          onClick={() =>
                            void runStudioAction(
                              async () => {
                                await processPlatformDocumentNow(authToken, document.id, naming);
                                await refreshAll();
                              },
                              "Unable to process document.",
                              "Document processing started.",
                            )
                          }
                        >
                          Process now
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!isLoading && activeTab === "agents" ? (
        <div className="nc-agent-studio__grid">
          <form className="nc-project-panel nc-agent-studio__surface" onSubmit={handleCreateAgent}>
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Draft workflow</p>
                <h3>Dynamic agent drafts</h3>
                <p>Shape new dynamic agents with the same polished forms and editor treatment used across the rest of the app.</p>
              </div>
            </div>

            <div className="nc-agent-studio__form-grid">
              <label className="nc-project-field">
                <span className="nc-project-field__label">Name</span>
                <input
                  value={agentForm.name}
                  onChange={(event) => setAgentForm((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Model</span>
                <input
                  value={agentForm.model_id}
                  onChange={(event) => setAgentForm((previous) => ({ ...previous, model_id: event.target.value }))}
                />
              </label>
              <label className="nc-project-field nc-agent-studio__field-span-full">
                <span className="nc-project-field__label">Description</span>
                <textarea
                  className="nc-project-field__textarea"
                  rows={4}
                  value={agentForm.description}
                  onChange={(event) => setAgentForm((previous) => ({ ...previous, description: event.target.value }))}
                />
              </label>
              <label className="nc-project-field">
                <span className="nc-project-field__label">Primary collection</span>
                <select value={selectedCollectionId} onChange={(event) => setSelectedCollectionId(event.target.value)}>
                  <option value="">No collection attached</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="nc-agent-studio__support-note">
                <strong>Current collection binding</strong>
                <p>
                  New drafts will be linked to the active collection above so routed answers can stay grounded in the same
                  workspace context.
                </p>
              </div>
              <label className="nc-project-field nc-agent-studio__field-span-full">
                <span className="nc-project-field__label">System prompt</span>
                <textarea
                  className="nc-project-field__textarea nc-agent-studio__prompt-editor"
                  rows={10}
                  value={agentForm.system_prompt}
                  onChange={(event) => setAgentForm((previous) => ({ ...previous, system_prompt: event.target.value }))}
                />
              </label>
            </div>

            <div className="nc-agent-studio__panel-actions">
              <button type="submit" className="nc-button nc-button--primary">
                Save draft
              </button>
            </div>
          </form>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Review and testing</p>
                <h3>Dynamic agent library</h3>
                <p>Choose an active draft, review status, and run a streaming test prompt before routing it into production chat.</p>
              </div>
            </div>

            <label className="nc-project-field">
              <span className="nc-project-field__label">Active agent</span>
              <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
                <option value="">Select an agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedAgent ? (
              <div className="nc-agent-studio__focus-card">
                <div className="nc-agent-studio__focus-header">
                  <div>
                    <p className="nc-agent-studio__section-kicker">Selected dynamic agent</p>
                    <strong>{selectedAgent.name}</strong>
                  </div>
                  <div className="nc-agent-studio__item-actions">
                    <span className="nc-agent-studio__badge">{selectedAgent.status}</span>
                    <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">
                      {selectedAgent.version?.model_id || "Default model"}
                    </span>
                  </div>
                </div>
                <p>{selectedAgent.description?.trim() || "This draft does not have a description yet."}</p>
                <div className="nc-agent-studio__item-meta">
                  <span>{selectedAgent.version?.collection_ids.length ?? 0} collection link(s)</span>
                  <span>{selectedAgent.version?.tool_ids.length ?? 0} tool link(s)</span>
                  <span>Version {selectedAgent.version?.version_number ?? 0}</span>
                </div>
              </div>
            ) : null}

            {agents.length === 0 ? (
              <StudioEmptyState
                title="No dynamic agents yet"
                description="Save your first draft and it will appear here for review, submission, approval, and testing."
              />
            ) : (
              <div className="nc-agent-studio__stack">
                {agents.map((agent) => (
                  <article key={agent.id} className="nc-agent-studio__item-card">
                    <div className="nc-agent-studio__item-copy">
                      <div className="nc-agent-studio__item-heading">
                        <strong>{agent.name}</strong>
                        <span className="nc-agent-studio__badge">{agent.status}</span>
                        <span className="nc-agent-studio__badge nc-agent-studio__badge--quiet">
                          {agent.version?.model_id || "Default model"}
                        </span>
                      </div>
                      <p>{agent.description?.trim() || "No description provided yet."}</p>
                      <div className="nc-agent-studio__item-meta">
                        <span>{agent.version?.collection_ids.length ?? 0} collection link(s)</span>
                        <span>{agent.version?.tool_ids.length ?? 0} tool link(s)</span>
                      </div>
                    </div>

                    <div className="nc-agent-studio__item-actions">
                      <button
                        type="button"
                        className="nc-button nc-button--ghost"
                        onClick={() =>
                          void runStudioAction(
                            async () => {
                              await submitPlatformAgent(authToken, agent.id, naming);
                              await refreshAll();
                            },
                            "Unable to submit agent.",
                            "Agent submitted.",
                          )
                        }
                      >
                        Submit
                      </button>
                      {isOwner ? (
                        <button
                          type="button"
                          className="nc-button nc-button--ghost"
                          onClick={() =>
                            void runStudioAction(
                              async () => {
                                await approvePlatformAgent(authToken, agent.id, naming);
                                await refreshAll();
                              },
                              "Unable to approve agent.",
                              "Agent approved.",
                            )
                          }
                        >
                          Approve
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <label className="nc-project-field">
              <span className="nc-project-field__label">Test prompt</span>
              <textarea
                className="nc-project-field__textarea"
                rows={5}
                value={agentPrompt}
                onChange={(event) => setAgentPrompt(event.target.value)}
              />
            </label>

            <div className="nc-agent-studio__panel-actions">
              <button type="button" className="nc-button nc-button--primary" onClick={() => void handleRunAgentTest()}>
                Run agent test
              </button>
            </div>

            {agentTestOutput ? (
              <div className="nc-agent-studio__result">
                <div className="nc-agent-studio__result-head">
                  <strong>Streaming test output</strong>
                  <span>Latest run</span>
                </div>
                <pre className="nc-agent-studio__code">{agentTestOutput}</pre>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {!isLoading && activeTab === "router" ? (
        <div className="nc-agent-studio__grid">
          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Prompt classification</p>
                <h3>Route preview</h3>
                <p>Paste a sample prompt and inspect where the platform would send it before you wire it into live chat.</p>
              </div>
            </div>

            <label className="nc-project-field">
              <span className="nc-project-field__label">Sample prompt</span>
              <textarea
                className="nc-project-field__textarea"
                rows={7}
                value={routePrompt}
                onChange={(event) => setRoutePrompt(event.target.value)}
              />
            </label>

            <div className="nc-agent-studio__panel-actions">
              <button type="button" className="nc-button nc-button--primary" onClick={() => void handlePreviewRoute()}>
                Preview route
              </button>
            </div>

            {routePreview ? (
              <div className="nc-agent-studio__result">
                <div className="nc-agent-studio__result-head">
                  <strong>Route result</strong>
                  <span>{Math.round(routePreview.confidence * 100)}% confidence</span>
                </div>
                <pre className="nc-agent-studio__code">{JSON.stringify(routePreview, null, 2)}</pre>
              </div>
            ) : null}
          </section>

          <section className="nc-project-panel nc-agent-studio__surface">
            <div className="nc-project-panel__header">
              <div className="nc-agent-studio__section-copy">
                <p className="nc-agent-studio__section-kicker">Routing context</p>
                <h3>What the router sees</h3>
                <p>Use this as a compact checkpoint before you decide whether the message should stay general, use documents, or switch into a dynamic agent.</p>
              </div>
            </div>

            <div className="nc-agent-studio__focus-card">
              <div className="nc-agent-studio__focus-header">
                <div>
                  <p className="nc-agent-studio__section-kicker">Current preview</p>
                  <strong>{routePreview ? routePreview.target_kind : "No route preview yet"}</strong>
                </div>
                {routePreview ? <span className="nc-agent-studio__badge">{Math.round(routePreview.confidence * 100)}%</span> : null}
              </div>
              <p>{formatRouteTarget(routePreview)}</p>
            </div>

            <div className="nc-agent-studio__fact-grid">
              <article className="nc-agent-studio__fact-card">
                <strong>{agents.length}</strong>
                <span>Dynamic agents available for routing</span>
              </article>
              <article className="nc-agent-studio__fact-card">
                <strong>{collections.length}</strong>
                <span>Collections available for document grounding</span>
              </article>
              <article className="nc-agent-studio__fact-card">
                <strong>{readyDocumentsCount}</strong>
                <span>Indexed documents ready for retrieval</span>
              </article>
              <article className="nc-agent-studio__fact-card">
                <strong>{activeProviderCount}</strong>
                <span>Active providers backing chat and embeddings</span>
              </article>
            </div>

            <div className="nc-agent-studio__facts">
              <article className="nc-agent-studio__fact-note">
                <strong>General path</strong>
                <p>Best when the request does not need collection grounding or a specialized dynamic agent system prompt.</p>
              </article>
              <article className="nc-agent-studio__fact-note">
                <strong>Document path</strong>
                <p>Best when the prompt should be grounded in your indexed knowledge collections before generating a reply.</p>
              </article>
              <article className="nc-agent-studio__fact-note">
                <strong>Dynamic agent path</strong>
                <p>Best when a focused system prompt and explicit workflow rules should take over the response.</p>
              </article>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
