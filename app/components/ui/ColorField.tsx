import { TextField } from "@shopify/polaris";
import styles from "./color-field.module.css";

// A merchant should never have to read or type rgba(...) — but the underlying default for
// some tokens (e.g. a border or empty-star color) is a transparent black overlay so it
// adapts to any theme background, which a plain hex value can't do. This approximates that
// overlay as a flat hex over white purely for display in the swatch/text field; the moment
// a merchant actually edits the field, the stored value becomes a real hex color like any
// other.
export function toDisplayHex(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
  if (!match) {
    return "#cccccc";
  }

  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
  const blend = (channel: string) => Math.round(Number(channel) * alpha + 255 * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(blend(match[1]))}${toHex(blend(match[2]))}${toHex(blend(match[3]))}`;
}

// Pairs a native color-swatch input with a hex text field — the one color-input pattern
// used everywhere in the app (Brand Studio, Widgets), instead of maintaining a bare hex
// TextField with no visual preview alongside a richer version elsewhere.
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const displayValue = toDisplayHex(value);

  return (
    <div className={styles.colorField}>
      <span className={styles.colorFieldLabel}>{label}</span>
      <div className={styles.colorFieldControl}>
        <input
          type="color"
          className={styles.colorSwatchInput}
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} color`}
        />
        <TextField label={label} labelHidden value={displayValue} onChange={onChange} autoComplete="off" />
      </div>
    </div>
  );
}
