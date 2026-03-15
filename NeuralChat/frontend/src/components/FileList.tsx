import { useEffect, useState } from "react";

import { deleteFile, getFiles } from "../api";
import type { RequestNamingContext } from "../api";
import type { UploadedFileItem } from "../types";

interface FileListProps {
  authToken: string;
  sessionId: string;
  naming?: RequestNamingContext;
  refreshKey?: number;
  onFilesChange?: (files: UploadedFileItem[]) => void;
}

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "🖼️";
  if (ext === "csv") return "📊";
  if (ext === "txt") return "📃";
  return "📁";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({ authToken, sessionId, naming, refreshKey, onFilesChange }: FileListProps) {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!authToken || !sessionId) return;

    setIsLoading(true);
    setErrorText("");

    getFiles(authToken, sessionId, naming)
      .then((response) => {
        setFiles(response.files);
        onFilesChange?.(response.files);
      })
      .catch(() => setErrorText("Could not load files."))
      .finally(() => setIsLoading(false));
  }, [authToken, sessionId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(filename: string) {
    if (deletingFilename) return;
    setDeletingFilename(filename);
    setErrorText("");

    try {
      await deleteFile(authToken, sessionId, filename, naming);
      const updated = files.filter((f) => f.filename !== filename);
      setFiles(updated);
      onFilesChange?.(updated);
    } catch {
      setErrorText(`Failed to delete "${filename}".`);
    } finally {
      setDeletingFilename(null);
    }
  }

  return (
    <div className="nc-file-list">
      <div className="nc-file-list__header">
        <span>Uploaded files</span>
        {files.length > 0 ? (
          <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-secondary)" }}>
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        ) : null}
      </div>

      {errorText ? (
        <p style={{ margin: "0 20px 12px", fontSize: "13px", color: "#dc2626" }}>{errorText}</p>
      ) : null}

      {isLoading ? (
        <div className="nc-file-list__empty">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
          </svg>
          <span>Loading files…</span>
        </div>
      ) : files.length === 0 ? (
        <div className="nc-file-list__empty">
          <svg viewBox="0 0 24 24" fill="none" width="32" height="32">
            <path d="M7.5 5.5H13L17.5 10V18.5C17.5 19.3 16.8 20 16 20H7.5C6.7 20 6 19.3 6 18.5V7C6 6.2 6.7 5.5 7.5 5.5Z"
              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            <path d="M13 5.5V10H17.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
          <span>No files uploaded yet</span>
          <span style={{ fontSize: "12px", opacity: 0.7 }}>Upload a PDF, DOCX, or TXT to ask questions about it</span>
        </div>
      ) : (
        <ul className="nc-file-list__items" role="list">
          {files.map((file) => (
            <li key={file.blob_path} className="nc-file-row" role="listitem">
              <span className="nc-file-row__icon" aria-hidden="true">
                {getFileIcon(file.filename)}
              </span>
              <span className="nc-file-row__meta">
                <span className="nc-file-row__name" title={file.filename}>
                  {file.filename}
                </span>
                <span className="nc-file-row__info">
                  {(file as unknown as Record<string, unknown>)["chunk_count"] != null
                    ? `${String((file as unknown as Record<string, unknown>)["chunk_count"])} chunks`
                    : "Ready"}
                  {(file as unknown as Record<string, unknown>)["size"] != null
                    ? ` · ${formatBytes(Number((file as unknown as Record<string, unknown>)["size"]))}`
                    : ""}
                </span>
              </span>
              <button
                type="button"
                className="nc-file-row__delete"
                aria-label={`Delete ${file.filename}`}
                disabled={deletingFilename === file.filename}
                onClick={() => void handleDelete(file.filename)}
              >
                {deletingFilename === file.filename ? (
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2"
                      strokeDasharray="25" strokeDashoffset="25" style={{ animation: "nc-spin 0.8s linear infinite" }}/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M6 7H18M10 11V17M14 11V17M9 7V5H15V7M19 7L18 19C18 19.6 17.4 20 17 20H7C6.6 20 6 19.6 6 19L5 7"
                      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}