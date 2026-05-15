import SMCTerminal from "@/components/SMCTerminal";
import type { SMCSignal } from "@/components/SMCTerminal";
import { getSMCSignalsAction } from "@/app/actions";

export default function SMCPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8">
      <SMCTerminal
        fetchAction={getSMCSignalsAction as unknown as (timeframe?: string) => Promise<SMCSignal[]>}
      />
    </div>
  );
}
