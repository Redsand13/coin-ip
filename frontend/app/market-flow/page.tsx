import { InstitutionalTerminal } from "@/components/InstitutionalTerminal";

export const metadata = {
  title: "Market Flow | Coinpree",
  description: "Real-time market flow analysis: CVD, VWAP, order book microstructure, whale detection, and smart money positioning.",
};

export default function MarketFlowPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8">
      <InstitutionalTerminal />
    </div>
  );
}
