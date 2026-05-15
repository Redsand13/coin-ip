import ICTTerminal from "@/components/ICTTerminal";
import { getICTSignalsAction } from "@/app/actions";

export default function ICTPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8">
      <ICTTerminal
        title="ICT"
        subtitle="Inner Circle Trader · Kill Zones · OTE · AMD · Order Blocks"
        initialData={[]}
        fetchAction={getICTSignalsAction}
        mode="ict"
      />
    </div>
  );
}
