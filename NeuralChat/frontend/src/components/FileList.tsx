import { useCallback, useEffect, useState } from "react";

import { deleteFile, getFiles } from "../api";
import type { RequestNamingContext } from "../api";
import type { UploadedFileItem } from "../types";

interface FileListProps {
  authToken: string;
  sessionId: string;
  naming?: RequestNamingContext;
  refreshKey: number;
  onFilesChange?: (files: UploadedFileItem[]) => void;
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M7.5 5.5H13L17.5 10V18.5C17.5 19.3 16.8 20 16 20H7.5C6.7 20 6 19.3 6 18.5V7C6 6.2 6.7 5.5 7.5 5.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 5.5V10H17.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M5 7H19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9 7V5.8C9 5.4 9.3 5 9.8 5H14.2C14.7 5 15 5.4 15 5.8V7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 7L8.6 18.1C8.7 19.2 9.6 20 10.7 20H13.3C14.4 20 15.3 19.2 15.4 18.1L16 7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.5 11V16M13.5 11V16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
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

export function FileList({ authToken, sessionId, naming, refreshKey, onFilesChange }: FileListProps) {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setErrorText("");

    try {
      const payload = await getFiles(authToken, sessionId, naming);
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
  }, [authToken, sessionId, naming, onFilesChange]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, refreshKey]);

  async function handleDelete(filename: string) {
    setErrorText("");
    try {
      await deleteFile(authToken, sessionId, filename, naming);
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
                <FileIcon />
              </span>
              <span className="nc-file-list__meta">
                <span className="nc-file-list__name">{fileItem.filename}</span>
                {fileItem.uploaded_at ? <span className="nc-file-list__time">{formatUploadedAt(fileItem.uploaded_at)}</span> : null}
              </span>
              <button type="button" aria-label={`Delete ${fileItem.filename}`} onClick={() => void handleDelete(fileItem.filename)}>
                <DeleteIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {errorText ? <p className="nc-file-list__error">{errorText}</p> : null}
    </section>
  );
}
