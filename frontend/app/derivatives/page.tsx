import DerivativesTerminal from "@/components/DerivativesTerminal";
import { getDerivativesAction } from "@/app/actions";

export const metadata = { title: "Market Sentiment — Coinpree" };

export default function DerivativesPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8">
      <DerivativesTerminal fetchAction={getDerivativesAction} />
    </div>
  );
}
