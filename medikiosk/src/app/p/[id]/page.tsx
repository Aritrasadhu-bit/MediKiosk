import { PatientPortalView } from "./portal-view";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
};

/** Public patient portal — /p/{encounterId}?code=xxxxx (code from the QR slip). */
export default async function PatientPortalPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { code } = await searchParams;
  return <PatientPortalView encounterId={id} code={code ?? ""} />;
}