import ICTTerminal from "@/components/ICTTerminal";
import { getICTSignalsAction } from "@/app/actions";

export default function ICTPage() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <ICTTerminal
        initialData={[]}
        fetchAction={getICTSignalsAction}
      />
    </div>
  );
}
