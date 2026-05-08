import ExchangeFuturesTerminal from "@/components/ExchangeFuturesTerminal";
import { getBinanceFuturesSignalsAction } from "@/app/actions";

export default function BinanceFuturesPage() {
    return (
        <div className="p-4 md:p-6 lg:p-8">
            <ExchangeFuturesTerminal
                title="EMA 3 CROSS"
                description="Binance Futures · Triple EMA Strategy 7 › 25 › 99"
                storageKey="coinpree_bf_signals_v12"
                exportSource="binance"
                scanInterval={20_000}
                initialData={[]}
                fetchAction={getBinanceFuturesSignalsAction}
            />
        </div>
    );
}
