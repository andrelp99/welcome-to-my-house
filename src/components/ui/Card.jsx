export function Card({ title, icon: Icon, accent = 'brand', children, className = '' }) {
  const strip = accent === 'accent' ? 'bg-brand-accent' : accent === 'positive' ? 'bg-positive' : 'bg-brand';
  return (
    <section
      className={`relative overflow-hidden bg-bg-surface rounded-lg p-5 shadow-card border border-bg-border ${className}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${strip}`} />
      {title && (
        <h2 className="flex items-center gap-2 text-text-secondary text-xs uppercase tracking-wider font-semibold mb-3">
          {Icon && <Icon size={16} />} {title}
        </h2>
      )}
      {children}
    </section>
  );
}
