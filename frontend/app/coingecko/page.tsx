import ExchangeFuturesTerminal from "@/components/ExchangeFuturesTerminal";
import { getCoingeckoSignalsAction } from "@/app/actions";

export default function CoingeckoPage() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <ExchangeFuturesTerminal
        title="COINGECKO MARKET"
        description="CoinGecko Market · Triple EMA Strategy 7 › 25 › 99"
        storageKey="coinpree_cg_signals_v8"
        exportSource="coingecko"
        scanInterval={60_000}
        initialData={[]}
        fetchAction={getCoingeckoSignalsAction}
      />
    </div>
  );
}
