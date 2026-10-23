import Link from "next/link";
import {
  ClipboardList,
  ShieldCheck,
  FileCheck2,
} from "lucide-react";

const modules = [
  {
    title: "PCU Submissions",
    description: "Review submitted transactions.",
    href: "/rhu/submissions",
    icon: ClipboardList,
  },
  {
    title: "Patient Verification",
    description: "CEC/eKonsulta verification workflow.",
    href: "/rhu/verification",
    icon: ShieldCheck,
  },
  {
    title: "PKRF Tracking",
    description: "Monitor registration case processing.",
    href: "/rhu/pkrf",
    icon: FileCheck2,
  },
];

export default function RHUPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-slate-900">
          Sebaste RHU
        </h1>

        <p className="mt-2 text-slate-500">
          Verification and PKRF Management
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon;

            return (
              <Link
                key={module.href}
                href={module.href}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300"
              >
                <Icon
                  className="mb-4 text-blue-700"
                  size={28}
                />

                <h2 className="font-semibold text-slate-900">
                  {module.title}
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  {module.description}
                </p>
              </Link>
            );
          })}
        </div>

        <p className="mt-8 text-sm text-amber-700">
          Staff verification functions are not yet enabled.
          Authorization must be implemented before
          accessing patient records.
        </p>
      </div>
    </main>
  );
}