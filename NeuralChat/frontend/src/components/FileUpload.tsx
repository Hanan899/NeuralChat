import { ChangeEvent, DragEvent, useRef, useState } from "react";

import { PermissionGate } from "@/components/auth/RoleGate";

import { uploadFileWithProgress, uploadProjectFileWithProgress } from "../api";
import type { RequestNamingContext } from "../api";
import type { UploadedFileItem } from "../types";
import { FileList } from "./FileList";

interface FileUploadProps {
  open: boolean;
  authToken: string;
  sessionId?: string;
  projectId?: string;
  naming?: RequestNamingContext;
  onClose: () => void;
  onFilesChange?: (files: UploadedFileItem[]) => void;
}

const ACCEPTED_EXTENSIONS_TEXT = "PDF, DOCX, TXT, CSV, PNG, JPG — max 25MB";

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M7 7L17 17M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function FileUpload({ open, authToken, sessionId, projectId, naming, onClose, onFilesChange }: FileUploadProps) {
  const inputReference = useRef<HTMLInputElement | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  if (!open) {
    return null;
  }

  async function handleFileUpload(file: File) {
    setIsUploading(true);
    setUploadProgress(0);
    setErrorText("");
    setSuccessText("");

    try {
      const response = projectId
        ? await uploadProjectFileWithProgress(authToken, projectId, file, setUploadProgress, naming)
        : await uploadFileWithProgress(authToken, sessionId as string, file, setUploadProgress, naming);
      setSuccessText(`✓ ${response.message || `${file.name} uploaded successfully`}`);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "File upload failed.";
      setErrorText(message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    void handleFileUpload(selectedFile);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) return;
    void handleFileUpload(droppedFile);
  }

  return (
    <div className="nc-file-upload-modal" role="dialog" aria-modal="true" aria-label="Upload files">
      <div className="nc-file-upload-modal__backdrop" onClick={onClose} />
      <section className="nc-file-upload-modal__panel">

        {/* Header */}
        <header className="nc-file-upload-modal__header">
          <h2>Upload files</h2>
          <button type="button" aria-label="Close file upload" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        {/* Dropzone */}
        <PermissionGate permission="file:upload">
          <>
            <button
              type="button"
              className={`nc-file-upload-dropzone ${isDragOver ? "nc-file-upload-dropzone--active" : ""}`}
              onClick={() => inputReference.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={handleDrop}
              disabled={isUploading}
            >
              <strong>{isDragOver ? "Drop to upload" : "Drag & drop or click to browse"}</strong>
              <span>{ACCEPTED_EXTENSIONS_TEXT}</span>
            </button>

            <input
              ref={inputReference}
              type="file"
              className="nc-file-upload-input"
              onChange={handleInputChange}
              accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg"
              aria-label="Browse files"
            />
          </>
        </PermissionGate>

        {/* Progress */}
        {isUploading ? (
          <div className="nc-upload-progress" aria-label="Upload progress">
            <div className="nc-upload-progress__bar">
              <div style={{ width: `${uploadProgress}%` }} />
            </div>
            <span>{uploadProgress}%</span>
          </div>
        ) : null}

        {/* Status messages */}
        {errorText ? <p className="nc-file-upload-error">{errorText}</p> : null}
        {successText ? <p className="nc-file-upload-success">{successText}</p> : null}

        {/* File list */}
        <FileList
          authToken={authToken}
          sessionId={sessionId}
          projectId={projectId}
          naming={naming}
          refreshKey={refreshKey}
          onFilesChange={onFilesChange}
        />

      </section>
    </div>
  );
}
