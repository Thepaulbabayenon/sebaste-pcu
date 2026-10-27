"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  CloudUpload,
  Copy,
  FileImage,
  HardDriveDownload,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import { BARANGAYS } from "@/app/lib/barangays";
import { saveOfflineSubmission } from "@/app/lib/offline-db";

type Outcome = "SUCCESS" | "FAILED";

type SubmissionResponse = {
  success: boolean;
  reference?: string;
  submittedBy?: string;
  sheetSyncStatus?: string;
  classification?: string;
  aiStatus?: string;
  error?: string;
};

type OfflineResult = {
  id: string;
  barangay: string;
  submittedBy: string;
  outcome: Outcome;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const inputClass =
  "block w-full rounded-xl border border-slate-200 " +
  "bg-white px-3.5 py-3 text-sm text-slate-900 " +
  "outline-none transition-colors " +
  "placeholder:text-slate-400 " +
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const primaryButton =
  "flex w-full items-center justify-center gap-2 " +
  "rounded-xl bg-blue-700 px-4 py-3.5 " +
  "text-sm font-semibold text-white transition " +
  "hover:bg-blue-800 disabled:cursor-not-allowed " +
  "disabled:bg-slate-300";

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10)
  );
}

export default function SubmitPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  // FORM INFORMATION

  const [barangay, setBarangay] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");

  const [outcome, setOutcome] =
    useState<Outcome>("SUCCESS");

  // PATIENT INFORMATION

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");

  // SCREENSHOT

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // SUBMISSION STATES

  const [loading, setLoading] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] =
    useState<SubmissionResponse | null>(null);

  const [offlineResult, setOfflineResult] =
    useState<OfflineResult | null>(null);

  const [copied, setCopied] = useState(false);

  const busy = loading || savingOffline;

  const failedInformationMissing =
    outcome === "FAILED" &&
    (!firstName.trim() ||
      !lastName.trim() ||
      !birthDate);

  const formInvalid =
    !barangay ||
    submittedBy.trim().length < 2 ||
    submittedBy.trim().length > 150 ||
    !file ||
    failedInformationMissing;

  // ===================================================
  // FILE PREVIEW
  // ===================================================

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  function clearPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setPreview(null);
  }

  function validateAndSetFile(selected: File | null) {
    if (!selected || busy || result || offlineResult) {
      return;
    }

    if (
      !["image/png", "image/jpeg"].includes(selected.type)
    ) {
      setError("Please upload a PNG or JPG screenshot.");
      return;
    }

    if (selected.size === 0) {
      setError("The selected screenshot is empty.");
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      setError("Screenshot must be smaller than 5 MB.");
      return;
    }

    clearPreview();

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
    if (busy) return;

    clearPreview();
    setFile(null);
    setError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    if (busy) return;

    validateAndSetFile(
      event.dataTransfer.files?.[0] ?? null
    );
  }

  // ===================================================
  // VALIDATION
  // ===================================================

  function validateForm(): boolean {
    if (!barangay) {
      setError("Please select your barangay.");
      return false;
    }

    if (
      submittedBy.trim().length < 2 ||
      submittedBy.trim().length > 150
    ) {
      setError(
        "Please enter the BHW or encoder's full name."
      );
      return false;
    }

    if (!file) {
      setError("Please attach the PCU screenshot.");
      return false;
    }

    if (
      file.size === 0 ||
      file.size > MAX_FILE_SIZE ||
      !["image/png", "image/jpeg"].includes(file.type)
    ) {
      setError(
        "Please select a valid JPG or PNG screenshot under 5 MB."
      );
      return false;
    }

    if (outcome === "FAILED") {
      if (!firstName.trim() || !lastName.trim()) {
        setError(
          "Please complete the required patient information."
        );
        return false;
      }

      if (!validBirthDate(birthDate)) {
        setError("Please enter a valid birthdate.");
        return false;
      }
    }

    return true;
  }

  // ===================================================
  // FORM ACTIONS
  // ===================================================

  function resetForm() {
    clearPreview();

    setBarangay("");
    setSubmittedBy("");
    setOutcome("SUCCESS");

    setFirstName("");
    setMiddleName("");
    setLastName("");
    setBirthDate("");

    setFile(null);
    setDragging(false);
    setError("");

    setResult(null);
    setOfflineResult(null);
    setCopied(false);
    busyRef.current = false;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // ===================================================
  // OFFLINE SAVE
  // ===================================================

  async function handleSaveOffline() {
    if (
      busyRef.current ||
      result ||
      offlineResult ||
      !validateForm() ||
      !file
    ) {
      return;
    }

    busyRef.current = true;
    setSavingOffline(true);
    setError("");

    try {
      const id = await saveOfflineSubmission({
        barangay,
        submittedBy: submittedBy.trim(),
        outcome,

        firstName:
          outcome === "FAILED"
            ? firstName.trim()
            : null,

        middleName:
          outcome === "FAILED"
            ? middleName.trim()
            : null,

        lastName:
          outcome === "FAILED"
            ? lastName.trim()
            : null,

        birthDate:
          outcome === "FAILED"
            ? birthDate
            : null,

        screenshot: file,
      });

      setOfflineResult({
        id,
        barangay,
        submittedBy: submittedBy.trim(),
        outcome,
      });

      console.info("PCU_OFFLINE_SUBMISSION_SAVED", {
        localId: id,
      });
    } catch (err: unknown) {
      console.error("PCU_OFFLINE_SAVE_FAILED", {
        errorType:
          err instanceof Error
            ? err.name
            : "UNKNOWN",
      });

      setError(
        "Unable to save the submission on this device. " +
          "Please check available storage."
      );
    } finally {
      busyRef.current = false;
      setSavingOffline(false);
    }
  }

  // ===================================================
  // ONLINE SUBMISSION
  // ===================================================

  async function submit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      busyRef.current ||
      result ||
      offlineResult ||
      !validateForm() ||
      !file
    ) {
      return;
    }

    busyRef.current = true;

    const body = new FormData();

    body.append("barangay", barangay);
    body.append("submittedBy", submittedBy.trim());
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
          data.error ||
            "Unable to submit the PCU transaction."
        );
      }

      if (!data.reference) {
        throw new Error(
          "The server did not return a submission reference."
        );
      }

      setResult(data);
    } catch (err: unknown) {
      setError(
        err instanceof TypeError
          ? "Unable to confirm whether the server received this submission. " +
              "Ask RHU to check before submitting it again."
          : err instanceof Error
            ? err.message
            : "Unable to confirm the submission."
      );
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  // ===================================================
  // CONFIRMATION SCREENS
  // ===================================================

  if (result || offlineResult) {
    const isOffline = Boolean(offlineResult);

    const reference = isOffline
      ? offlineResult!.id
      : result!.reference ?? "";

    const displayName = isOffline
      ? offlineResult!.submittedBy
      : result!.submittedBy ?? submittedBy;

    const displayBarangay = isOffline
      ? offlineResult!.barangay
      : barangay;

    const displayOutcome = isOffline
      ? offlineResult!.outcome
      : outcome;

    return (
      <main className="min-h-screen bg-[#f8fafc] px-4 py-10 sm:py-20">
        <div className="mx-auto max-w-md">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="px-6 pb-7 pt-9 text-center sm:px-8">
              <div
                className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
                  isOffline
                    ? "bg-amber-50"
                    : "bg-emerald-50"
                }`}
              >
                {isOffline ? (
                  <HardDriveDownload className="h-8 w-8 text-amber-700" />
                ) : (
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                )}
              </div>

              <h1 className="mt-5 text-2xl font-semibold text-slate-900">
                {isOffline
                  ? "Saved on this device"
                  : "Submission received"}
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                {isOffline
                  ? "Your PCU screenshot has been saved locally."
                  : "Your PCU transaction has been saved on the RHU server."}
              </p>

              {isOffline && (
                <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
                  <WifiOff className="h-5 w-5 shrink-0 text-amber-700" />

                  <p className="text-xs leading-5 text-amber-900">
                    This submission has NOT been sent to
                    the RHU. It remains only on this
                    device until the upload functionality
                    is implemented.
                  </p>
                </div>
              )}

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                <p className="text-xs font-medium text-slate-500">
                  {isOffline
                    ? "Local reference number"
                    : "Server reference number"}
                </p>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="min-w-0 break-all font-mono text-xs text-slate-800">
                    {reference}
                  </p>

                  <button
                    type="button"
                    onClick={() => copyReference(reference)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700"
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
                <div className="flex justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Submitted by
                  </span>
                  <span className="break-words text-right text-sm font-medium text-slate-900">
                    {displayName}
                  </span>
                </div>

                <div className="flex justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Barangay
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {displayBarangay}
                  </span>
                </div>

                <div className="flex justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Transaction
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {displayOutcome === "SUCCESS"
                      ? "Success"
                      : "Failed PCU"}
                  </span>
                </div>

                <div className="flex justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    Upload status
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      isOffline
                        ? "text-amber-700"
                        : "text-emerald-700"
                    }`}
                  >
                    {isOffline
                      ? "Saved locally"
                      : "Received by server"}
                  </span>
                </div>

                {!isOffline && (
                  <>
                    <div className="flex justify-between gap-3">
                      <span className="text-sm text-slate-500">
                        AI extraction
                      </span>
                      <span className="text-sm font-medium text-slate-700">
                        {result?.aiStatus === "SKIPPED"
                          ? "Not required"
                          : result?.aiStatus === "COMPLETED"
                            ? "Completed"
                            : "Pending processing"}
                      </span>
                    </div>

                    <div className="flex justify-between gap-3">
                      <span className="text-sm text-slate-500">
                        Spreadsheet
                      </span>
                      <span className="text-sm font-medium text-slate-700">
                        {result?.sheetSyncStatus === "SYNCED"
                          ? "Synced"
                          : "Pending sync"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={resetForm}
                className={`${primaryButton} mt-7`}
              >
                <RotateCcw className="h-4 w-4" />
                Create another submission
              </button>

              {isOffline && (
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  Do not clear this browser's application
                  data. Local submissions are not
                  backed up to the RHU server yet.
                </p>
              )}
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-slate-400">
            Sebaste Rural Health Unit
          </p>
        </div>
      </main>
    );
  }

  // ===================================================
  // MAIN FORM
  // ===================================================

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl">
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

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Submit PCU transaction
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Record the PCU result and attach a screenshot
            for RHU review.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          {/* BARANGAY */}

          <section className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">
              1. Barangay
            </h2>

            <p className="mb-4 text-xs text-slate-500">
              Select the patient's barangay.
            </p>

            <label
              htmlFor="barangay"
              className="mb-2 block text-xs font-medium text-slate-700"
            >
              Barangay name *
            </label>

            <select
              id="barangay"
              name="barangay"
              value={barangay}
              onChange={(event) =>
                setBarangay(event.target.value)
              }
              required
              disabled={busy}
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

          {/* NEW: SUBMITTED BY */}

          <section className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">
              2. Submitted by
            </h2>

            <p className="mb-4 text-xs leading-5 text-slate-500">
              Identify the BHW or encoder responsible
              for this PCU transaction.
            </p>

            <label
              htmlFor="submittedBy"
              className="mb-2 block text-xs font-medium text-slate-700"
            >
              BHW / Encoder full name
              <span className="ml-1 text-rose-500">*</span>
            </label>

            <input
              id="submittedBy"
              name="submittedBy"
              type="text"
              maxLength={150}
              required
              disabled={busy}
              value={submittedBy}
              onChange={(event) =>
                setSubmittedBy(event.target.value)
              }
              placeholder="Enter your full name"
              className={inputClass}
            />

            <p className="mt-2 text-xs text-slate-500">
              Used for submission tracking and RHU
              accountability.
            </p>
          </section>

          {/* TRANSACTION RESULT */}

          <section className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">
              3. Transaction result
            </h2>

            <p className="mb-4 text-xs text-slate-500">
              What result appeared in the PCU system?
            </p>

            <fieldset disabled={busy}>
              <legend className="sr-only">
                PCU transaction result
              </legend>

              <div className="grid grid-cols-2 gap-3">
                {(["SUCCESS", "FAILED"] as const).map(
                  (value) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors ${
                        outcome === value
                          ? "border-blue-600 bg-blue-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        {value === "SUCCESS" ? (
                          <CheckCircle2
                            className={`h-5 w-5 ${
                              outcome === value
                                ? "text-blue-700"
                                : "text-slate-400"
                            }`}
                          />
                        ) : (
                          <CircleAlert
                            className={`h-5 w-5 ${
                              outcome === value
                                ? "text-blue-700"
                                : "text-slate-400"
                            }`}
                          />
                        )}

                        <input
                          type="radio"
                          name="outcome"
                          value={value}
                          checked={outcome === value}
                          onChange={() => setOutcome(value)}
                          className="accent-blue-700"
                        />
                      </span>

                      <span className="text-sm font-semibold text-slate-900">
                        {value === "SUCCESS"
                          ? "Success"
                          : "Failed"}
                      </span>

                      <span className="text-xs text-slate-500">
                        {value === "SUCCESS"
                          ? "Transaction completed"
                          : "Transaction unsuccessful"}
                      </span>
                    </label>
                  )
                )}
              </div>
            </fieldset>
          </section>

          {/* CONDITIONAL PATIENT FIELDS */}

          {outcome === "FAILED" && (
            <section className="border-b border-slate-100 bg-slate-50/50 px-5 py-6 sm:px-7">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">
                Patient information
              </h2>

              <p className="mb-5 text-xs text-slate-500">
                Required for follow-up and
                CEC/eKonsulta checking.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="firstName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    First name *
                  </label>

                  <input
                    id="firstName"
                    type="text"
                    maxLength={100}
                    required
                    disabled={busy}
                    value={firstName}
                    onChange={(event) =>
                      setFirstName(event.target.value)
                    }
                    className={inputClass}
                    placeholder="First name"
                  />
                </div>

                <div>
                  <label
                    htmlFor="middleName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Middle name (optional)
                  </label>

                  <input
                    id="middleName"
                    type="text"
                    maxLength={100}
                    disabled={busy}
                    value={middleName}
                    onChange={(event) =>
                      setMiddleName(event.target.value)
                    }
                    className={inputClass}
                    placeholder="Middle name"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lastName"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Last name *
                  </label>

                  <input
                    id="lastName"
                    type="text"
                    maxLength={100}
                    required
                    disabled={busy}
                    value={lastName}
                    onChange={(event) =>
                      setLastName(event.target.value)
                    }
                    className={inputClass}
                    placeholder="Last name"
                  />
                </div>

                <div>
                  <label
                    htmlFor="birthDate"
                    className="mb-2 block text-xs font-medium text-slate-700"
                  >
                    Birthdate *
                  </label>

                  <input
                    id="birthDate"
                    type="date"
                    required
                    disabled={busy}
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

          {/* SCREENSHOT */}

          <section className="px-5 py-6 sm:px-7">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">
              4. PCU screenshot
            </h2>

            <p className="mb-4 text-xs text-slate-500">
              JPG or PNG, maximum 5 MB.
            </p>

            {!file ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDrop={onDrop}
                className={`rounded-xl border-2 border-dashed p-7 text-center ${
                  dragging
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <CloudUpload className="mx-auto h-8 w-8 text-slate-400" />

                <p className="mt-3 text-sm font-medium text-slate-800">
                  Choose or drop a screenshot
                </p>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    fileInputRef.current?.click()
                  }
                  className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800"
                >
                  Browse files
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex max-h-72 items-center justify-center bg-slate-100 p-3">
                  {preview && (
                    <img
                      src={preview}
                      alt="PCU screenshot preview"
                      className="max-h-64 max-w-full rounded-lg object-contain"
                    />
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileImage className="h-5 w-5 shrink-0 text-blue-700" />

                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-900">
                        {file.name}
                      </p>

                      <p className="text-xs text-slate-500">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={removeFile}
                    aria-label="Remove screenshot"
                    className="rounded-lg p-2 text-slate-500 hover:text-red-600"
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
              disabled={busy}
              onChange={selectFile}
              aria-label="Choose PCU screenshot"
              className="sr-only"
            />

            {file && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  fileInputRef.current?.click()
                }
                className="mt-3 text-xs font-medium text-blue-700"
              >
                Change screenshot
              </button>
            )}
          </section>

          {/* ERROR */}

          {error && (
            <div
              role="alert"
              className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3.5 text-sm text-red-700 sm:mx-7"
            >
              <CircleAlert className="h-4 w-4 shrink-0" />

              <span className="flex-1">{error}</span>

              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* SUBMISSION FOOTER */}

          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-7">
            <button
              type="button"
              onClick={handleSaveOffline}
              disabled={busy || formInvalid}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-700 bg-white px-4 py-3.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:border-slate-300 disabled:text-slate-400"
            >
              {savingOffline ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Saving on device...
                </>
              ) : (
                <>
                  <HardDriveDownload className="h-4 w-4" />
                  Save Offline
                </>
              )}
            </button>

            <button
              type="submit"
              disabled={busy || formInvalid}
              className={primaryButton}
            >
              {loading ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit transaction
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <p className="mt-3 text-center text-xs leading-5 text-slate-500">
              Save Offline stores the transaction on
              this device. Submit transaction sends
              it to the RHU server.
            </p>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              Subject to RHU verification.
            </p>
          </div>
        </form>

        <footer className="mt-6 text-center text-xs text-slate-400">
          Sebaste Rural Health Unit · PCU System
        </footer>
      </div>
    </main>
  );
}