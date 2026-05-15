import SignalHistoryTerminal from "@/components/SignalHistoryTerminal";

export const metadata = {
  title: "Signal History | Coinpree Algo Terminal",
  description: "Complete historical database of all detected signals across Binance and ICT strategies.",
};

export default function HistoryPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8">
      <SignalHistoryTerminal />
    </div>
  );
}
