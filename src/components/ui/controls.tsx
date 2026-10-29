/** 基础控件：dbx 密度规范（h-8/h-7/h-6，text-xs 主体，无阴影，1px border + 色阶分层）
 *  不带第三方 cva 依赖，手写变体表。新代码优先用这里的组件而非散落的手写 className。 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'xs' | 'icon' | 'icon-sm' | 'icon-xs';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-input bg-transparent hover:bg-accent hover:text-foreground',
  ghost: 'hover:bg-accent hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'h-8 px-2.5 text-xs',
  sm: 'h-7 px-2 text-xs',
  xs: 'h-6 px-1.5 text-[11px]',
  icon: 'h-8 w-8',
  'icon-sm': 'h-7 w-7',
  'icon-xs': 'h-6 w-6',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 dark:bg-input/30 ${className}`}
        {...rest}
      />
    );
  },
);

type BadgeTone = 'muted' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export function Badge({
  tone = 'muted',
  className = '',
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
