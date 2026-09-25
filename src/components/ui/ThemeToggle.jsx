import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
      title={isDark ? 'Tema chiaro' : 'Tema scuro'}
      className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-bg-elevated border border-bg-border text-text-secondary hover:text-text-primary hover:border-brand transition-colors"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
