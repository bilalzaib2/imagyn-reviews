import styles from "./progress-bar.module.css";

type ProgressBarProps = {
  // 0-100, already clamped by the caller. null when there's no known total yet (an
  // indeterminate/pulsing bar rather than a stalled-looking one stuck at 0%).
  percent: number | null;
  label: string;
};

export function ProgressBar({ percent, label }: ProgressBarProps) {
  return (
    <div className={styles.wrap} role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={styles.track}>
        <div
          className={`${styles.fill} ${percent === null ? styles.indeterminate : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
