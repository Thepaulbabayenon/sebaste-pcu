import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

export default function CulasiPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-slate-900">
          Culasi Encoder
        </h1>

        <p className="mt-2 text-slate-500">
          PKRF Registration Processing
        </p>

        <Link
          href="/culasi/registration"
          className="mt-8 block max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <ClipboardCheck
            size={28}
            className="mb-4 text-blue-700"
          />

          <h2 className="font-semibold">
            Registration Queue
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Process verified registration cases.
          </p>
        </Link>

        <p className="mt-6 text-sm text-amber-700">
          Registration updates are disabled until
          encoder authorization is implemented.
        </p>
      </div>
    </main>
  );
}