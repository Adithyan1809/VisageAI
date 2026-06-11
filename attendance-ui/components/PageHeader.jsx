  export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {title && (
            <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
          )}
          {subtitle && (
            <p className="text-sm muted mt-1">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-3">{actions}</div>
      </div>
    </div>
  );
}
