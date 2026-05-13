export default function Loading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-6 w-40 bg-muted rounded mb-2" />
          <div className="h-4 w-64 bg-muted/60 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-muted rounded" />
          <div className="h-8 w-20 bg-muted rounded" />
        </div>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-lg" />
        ))}
      </div>
      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-7 w-16 bg-muted rounded-full" />
        ))}
      </div>
      {/* Table rows */}
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 rounded" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}
