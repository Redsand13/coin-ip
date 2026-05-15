import ExchangeFuturesTerminal from "@/components/ExchangeFuturesTerminal";
import { getBinanceFuturesSignalsAction } from "@/app/actions";

export default function BinanceFuturesPage() {
    return (
        <div className="p-2 sm:p-4 md:p-6 lg:p-8">
            <ExchangeFuturesTerminal
                title="EMA 3 CROSS"
                storageKey="coinpree_bf_signals_v13"
                exportSource="binance"
                scanInterval={5_000}
                initialData={[]}
                fetchAction={getBinanceFuturesSignalsAction}
            />
        </div>
    );
}
