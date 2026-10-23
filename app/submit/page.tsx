
"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type DragEvent,
} from "react";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  CloudUpload,
  FileImage,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
  Copy,
} from "lucide-react";

import { BARANGAYS } from "@/app/lib/barangays";

type Outcome = "SUCCESS" | "FAILED";

type SubmissionResponse = {
  success: boolean;
  reference?: string;
  sheetSyncStatus?: string;
  classification?: string;
  targetSheet?: string | null;
  error?: string;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const inputClass =
  "block w-full rounded-xl border border-slate-200 " +
  "bg-white px-3.5 py-3 text-sm text-slate-900 " +
  "outline-none transition-colors " +
  "placeholder:text-slate-400 " +
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SubmitPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [barangay, setBarangay] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("SUCCESS");

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] =
    useState<SubmissionResponse | null>(null);

  const [copied, setCopied] = useState(false);

  // Clean up object URLs when images change or the
  // component unmounts.
 useEffect(() => {
  return () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };
}, []);

  function validateAndSetFile(selected: File | null) {
  if (!selected) return;

  if (!["image/png", "image/jpeg"].includes(selected.type)) {
    setError("Please upload a PNG or JPG screenshot.");
    return;
  }

  if (selected.size > MAX_FILE_SIZE) {
    setError("Screenshot must be smaller than 5 MB.");
    return;
  }

  if (selected.size === 0) {
    setError("The selected image is empty.");
    return;
  }

  // Remove previous preview URL.
  if (previewUrlRef.current) {
    URL.revokeObjectURL(previewUrlRef.current);
  }

  // Create a preview for the newly selected image.
  const url = URL.createObjectURL(selected);

  previewUrlRef.current = url;

  setFile(selected);
  setPreview(url);
  setError("");
}

  function selectFile(
    event: ChangeEvent<HTMLInputElement>
  ) {
    validateAndSetFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  function removeFile() {
    setFile(null);
    setError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    if (loading) return;

    validateAndSetFile(
      event.dataTransfer.files?.[0] ?? null
    );
  }

  function resetForm() {
    setBarangay("");
    setOutcome("SUCCESS");

    setFirstName("");
    setMiddleName("");
    setLastName("");
    setBirthDate("");

    setFile(null);
    setResult(null);
    setError("");
    setCopied(false);
    setDragging(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function copyReference() {
    if (!result?.reference) return;

    try {
      await navigator.clipboard.writeText(
        result.reference
      );

      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function submit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (loading) return;

    if (!barangay) {
      setError("Please select your barangay.");
      return;
    }

    if (!file) {
      setError("Please upload the PCU screenshot.");
      return;
    }

    const body = new FormData();

    body.append("barangay", barangay);
    body.append("outcome", outcome);
    body.append("screenshot", file);

    if (outcome === "FAILED") {
      body.append("firstName", firstName.trim());
      body.append("middleName", middleName.trim());
      body.append("lastName", lastName.trim());
      body.append("birthDate", birthDate);
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        body,
      });

      const data =
        (await response.json()) as SubmissionResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Unable to submit transaction."
        );
      }

      if (!data.reference) {
        throw new Error(
          "Submission response is missing a reference."
        );
      }

      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // ==================================================
  // SUCCESS SCREEN
  // ==================================================

  if (result) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-4 py-10 sm:py-20">
        <div className="mx-auto max-w-md">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="px-6 pb-7 pt-9 text-center sm:px-8">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2
                  className="h-8 w-8 text-emerald-600"
                  strokeWidth={1.8}
                />
              </div>

              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">
                Submission received
              </h1>

              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">
                Your PCU transaction has been saved.
                RHU staff will review the information.
              </p>

              <div className="mt-7 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                <p className="text-xs font-medium text-slate-500">
                  Reference number
                </p>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="min-w-0 break-all font-mono text-xs leading-6 text-slate-800">
                    {result.reference}
                  </p>

                  <button
                    type="button"
                    onClick={copyReference}
                    aria-label="Copy reference number"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}

                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Transaction
                  </span>

                  <span className="text-sm font-medium text-slate-900">
                    {outcome === "SUCCESS"
                      ? "Success"
                      : "Failed PCU"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Barangay
                  </span>

                  <span className="text-sm font-medium text-slate-900">
                    {barangay}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Spreadsheet
                  </span>

                  <span
                    className={`text-sm font-medium ${
                      result.sheetSyncStatus === "SYNCED"
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    {result.sheetSyncStatus === "SYNCED"
                      ? "Synced"
                      : "Pending sync"}
                  </span>
                </div>
              </div>

              {result.sheetSyncStatus !== "SYNCED" && (
                <div
                  role="status"
                  className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-left text-xs leading-5 text-amber-800"
                >
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />

                  <span>
                    The transaction is saved in the
                    database, but spreadsheet syncing
                    is still pending. Do not submit it
                    again just to retry syncing.
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={resetForm}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <RotateCcw className="h-4 w-4" />
                Submit another transaction
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-slate-400">
            Sebaste Rural Health Unit
          </p>
        </div>
      </main>
    );
  }

  // ==================================================
  // MAIN FORM
  // ==================================================

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl">

        {/* HEADER */}
        <header className="mb-7">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-white">
              <ClipboardCheck className="h-5 w-5" />
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-900">
                Sebaste RHU
              </p>

              <p className="text-xs text-slate-500">
                PCU Registration Tracker
              </p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">
            Submit PCU transaction
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Record the transaction result and upload
            a screenshot for RHU review.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >

          {/* STEP 1 - BARANGAY */}
          <section className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                1
              </span>

              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Barangay
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Select the patient's barangay.
                </p>
              </div>
            </div>

            <label
              htmlFor="barangay"
              className="mb-2 block text-xs font-medium text-slate-600"
            >
              Barangay name
            </label>

            <select
              id="barangay"
              name="barangay"
              value={barangay}
              onChange={(event) =>
                setBarangay(event.target.value)
              }
              required
              disabled={loading}
              className={inputClass}
            >
              <option value="">Choose a barangay</option>

              {BARANGAYS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </section>

          {/* STEP 2 - RESULT */}
          <section className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                2
              </span>

              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Transaction result
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  What result appeared in the PCU system?
                </p>
              </div>
            </div>

            <fieldset disabled={loading}>
              <legend className="sr-only">
                PCU transaction result
              </legend>

              <div className="grid grid-cols-2 gap-3">
                <label
                  className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors ${
                    outcome === "SUCCESS"
                      ? "border-blue-600 bg-blue-50/60"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value="SUCCESS"
                    checked={outcome === "SUCCESS"}
                    onChange={() =>
                      setOutcome("SUCCESS")
                    }
                    className="sr-only"
                  />

                  <span className="flex items-center justify-between">
                    <CheckCircle2
                      className={`h-5 w-5 ${
                        outcome === "SUCCESS"
                          ? "text-blue-700"
                          : "text-slate-400"
                      }`}
                    />

                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        outcome === "SUCCESS"
                          ? "border-blue-700 bg-blue-700"
                          : "border-slate-300"
                      }`}
                    >
                      {outcome === "SUCCESS" && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </span>
                  </span>

                  <span className="text-sm font-semibold text-slate-900">
                    Success
                  </span>

                  <span className="text-xs leading-5 text-slate-500">
                    Transaction completed
                  </span>
                </label>

                <label
                  className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors ${
                    outcome === "FAILED"
                      ? "border-blue-600 bg-blue-50/60"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value="FAILED"
                    checked={outcome === "FAILED"}
                    onChange={() =>
                      setOutcome("FAILED")
                    }
                    className="sr-only"
                  />

                  <span className="flex items-center justify-between">
                    <CircleAlert
                      className={`h-5 w-5 ${
                        outcome === "FAILED"
                          ? "text-blue-700"
                          : "text-slate-400"
                      }`}
                    />

                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        outcome === "FAILED"
                          ? "border-blue-700 bg-blue-700"
                          : "border-slate-300"
                      }`}
                    >
                      {outcome === "FAILED" && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </span>
                  </span>

                  <span className="text-sm font-semibold text-slate-900">
                    Failed
                  </span>

                  <span className="text-xs leading-5 text-slate-500">
                    Transaction unsuccessful
                  </span>
                </label>
              </div>
            </fieldset>
          </section>

          {/* CONDITIONAL PATIENT FIELDS */}
          {outcome === "FAILED" && (
            <section className="border-b border-slate-100 bg-slate-50/50 px-5 py-6 sm:px-7">
              <div className="mb-5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Patient information
                </h2>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Required for follow-up and
                  CEC/eKonsulta checking.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="firstName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    First name
                    <span className="ml-1 text-rose-500">*</span>
                  </label>

                  <input
                    id="firstName"
                    type="text"
                    autoComplete="given-name"
                    maxLength={100}
                    required
                    disabled={loading}
                    value={firstName}
                    onChange={(event) =>
                      setFirstName(event.target.value)
                    }
                    placeholder="First name"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="middleName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Middle name
                    <span className="ml-1 font-normal text-slate-400">
                      (optional)
                    </span>
                  </label>

                  <input
                    id="middleName"
                    type="text"
                    maxLength={100}
                    disabled={loading}
                    value={middleName}
                    onChange={(event) =>
                      setMiddleName(event.target.value)
                    }
                    placeholder="Middle name"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="lastName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Last name
                    <span className="ml-1 text-rose-500">*</span>
                  </label>

                  <input
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    maxLength={100}
                    required
                    disabled={loading}
                    value={lastName}
                    onChange={(event) =>
                      setLastName(event.target.value)
                    }
                    placeholder="Last name"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="birthDate"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Birthdate
                    <span className="ml-1 text-rose-500">*</span>
                  </label>

                  <input
                    id="birthDate"
                    type="date"
                    required
                    disabled={loading}
                    max={new Date().toISOString().slice(0, 10)}
                    value={birthDate}
                    onChange={(event) =>
                      setBirthDate(event.target.value)
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </section>
          )}

          {/* STEP 3 - SCREENSHOT */}
          <section className="px-5 py-6 sm:px-7">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                3
              </span>

              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Upload screenshot
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Add a screenshot showing the PCU
                  transaction result.
                </p>
              </div>
            </div>

            {!file ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!loading) setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDrop={onDrop}
                className={`relative rounded-xl border-2 border-dashed p-7 text-center transition-colors ${
                  dragging
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-slate-50/50 hover:border-blue-300"
                }`}
              >
                <CloudUpload className="mx-auto h-8 w-8 text-slate-400" />

                <p className="mt-3 text-sm font-medium text-slate-800">
                  Choose or drop a screenshot
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  JPG or PNG · Maximum 5 MB
                </p>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    fileInputRef.current?.click()
                  }
                  className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Browse files
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="relative flex max-h-72 items-center justify-center bg-slate-100 p-3">
                  {preview && (
                    <img
                      src={preview}
                      alt="Selected PCU screenshot preview"
                      className="max-h-64 w-auto max-w-full rounded-lg object-contain"
                    />
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <FileImage className="h-4 w-4 text-blue-700" />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-900">
                        {file.name}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={removeFile}
                    aria-label="Remove screenshot"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              id="screenshot"
              type="file"
              accept="image/png,image/jpeg"
              disabled={loading}
              onChange={selectFile}
              aria-label="Choose PCU screenshot"
              className="sr-only"
            />

            {file && (
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  fileInputRef.current?.click()
                }
                className="mt-3 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
              >
                Change screenshot
              </button>
            )}
          </section>

          {/* ERRORS */}
          {error && (
            <div
              role="alert"
              className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3.5 text-sm text-red-700 sm:mx-7"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />

              <span className="flex-1">{error}</span>

              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
                className="shrink-0 text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* SUBMISSION FOOTER */}
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-7">
            <button
              type="submit"
              disabled={
                loading ||
                !file ||
                !barangay ||
                (outcome === "FAILED" &&
                  (!firstName.trim() ||
                    !lastName.trim() ||
                    !birthDate))
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Processing screenshot...
                </>
              ) : (
                <>
                  Submit transaction
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              Submission is subject to RHU verification.
            </p>
          </div>
        </form>

        <footer className="mt-6 text-center">
          <p className="text-xs text-slate-400">
            Sebaste Rural Health Unit · PCU System
          </p>
        </footer>
      </div>
    </main>
  );
}
