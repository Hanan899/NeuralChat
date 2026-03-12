import { useCallback, useEffect, useState } from "react";

import { deleteFile, getFiles } from "../api";
import type { UploadedFileItem } from "../types";

interface FileListProps {
  authToken: string;
  sessionId: string;
  refreshKey: number;
  onFilesChange?: (files: UploadedFileItem[]) => void;
}

function formatUploadedAt(timestamp: string): string {
  if (!timestamp) {
    return "";
  }
  const dateValue = new Date(timestamp);
  if (Number.isNaN(dateValue.getTime())) {
    return "";
  }
  return dateValue.toLocaleString();
}

export function FileList({ authToken, sessionId, refreshKey, onFilesChange }: FileListProps) {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setErrorText("");

    try {
      const payload = await getFiles(authToken, sessionId);
      setFiles(payload.files);
      onFilesChange?.(payload.files);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load uploaded files.";
      setErrorText(message);
      setFiles([]);
      onFilesChange?.([]);
    } finally {
      setIsLoading(false);
    }
  }, [authToken, sessionId, onFilesChange]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, refreshKey]);

  async function handleDelete(filename: string) {
    setErrorText("");
    try {
      await deleteFile(authToken, sessionId, filename);
      const remainingFiles = files.filter((fileItem) => fileItem.filename !== filename);
      setFiles(remainingFiles);
      onFilesChange?.(remainingFiles);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete file.";
      setErrorText(message);
    }
  }

  return (
    <section className="nc-file-list" aria-label="Uploaded files">
      <header className="nc-file-list__header">
        <h3>Uploaded files</h3>
      </header>

      {isLoading ? (
        <div className="nc-file-list__skeleton" aria-label="Loading files">
          <div className="nc-file-list__skeleton-row" />
          <div className="nc-file-list__skeleton-row" />
          <div className="nc-file-list__skeleton-row" />
        </div>
      ) : null}

      {!isLoading && files.length === 0 ? (
        <p className="nc-file-list__empty">No files uploaded yet — upload a PDF, DOCX, or TXT to ask questions about it</p>
      ) : null}

      {!isLoading && files.length > 0 ? (
        <ul className="nc-file-list__rows">
          {files.map((fileItem) => (
            <li key={fileItem.blob_path} className="nc-file-list__row">
              <span className="nc-file-list__icon" aria-hidden="true">
                📄
              </span>
              <span className="nc-file-list__meta">
                <span className="nc-file-list__name">{fileItem.filename}</span>
                {fileItem.uploaded_at ? <span className="nc-file-list__time">{formatUploadedAt(fileItem.uploaded_at)}</span> : null}
              </span>
              <button type="button" aria-label={`Delete ${fileItem.filename}`} onClick={() => void handleDelete(fileItem.filename)}>
                🗑️
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {errorText ? <p className="nc-file-list__error">{errorText}</p> : null}
    </section>
  );
}
