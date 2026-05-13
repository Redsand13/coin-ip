export default function Loading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-6 w-36 bg-muted rounded mb-2" />
          <div className="h-4 w-72 bg-muted/60 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-28 bg-muted rounded" />
          <div className="h-8 w-20 bg-muted rounded" />
        </div>
      </div>
      {/* Search + filter bar */}
      <div className="flex gap-3 mb-5">
        <div className="h-9 flex-1 bg-muted rounded" />
        <div className="h-9 w-28 bg-muted rounded" />
        <div className="h-9 w-28 bg-muted rounded" />
      </div>
      <div className="space-y-2">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-11 bg-muted/50 rounded" style={{ opacity: 1 - i * 0.08 }} />
        ))}
      </div>
    </div>
  );
}
