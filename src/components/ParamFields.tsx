import { Dices } from 'lucide-react';
import type { ParamDef, ParamValue, Params } from '@vectr/core';
import { IconButton, Select, Slider, TextField, Toggle } from './controls';

/** Is this param relevant given the current values (e.g. "Turns" only for spirals)? */
export const isActive = (def: ParamDef, values: Params) => !def.when || def.when.in.includes(String(values[def.when.key]));

/**
 * Renders controls for any block schema — a source, an operator or the style —
 * so new blocks get a UI for free. Params that don't apply are hidden.
 */
export function ParamFields({
  defs, values, onChange, only,
}: {
  defs: ParamDef[];
  values: Params;
  onChange(key: string, value: ParamValue): void;
  only?: (def: ParamDef) => boolean;
}) {
  return (
    <>
      {defs.filter((d) => isActive(d, values) && (!only || only(d))).map((d) => {
        const v = values[d.key];
        const hint = d.help ? <p className="-mt-1.5 text-[11px] leading-snug text-zinc-500">{d.help}</p> : null;
        switch (d.kind) {
          case 'range':
            return (
              <div key={d.key}>
                <Slider label={d.label} min={d.min} max={d.max} step={d.step} unit={d.unit} value={Number(v)} onChange={(x) => onChange(d.key, x)} />
                {hint}
              </div>
            );
          case 'toggle':
            return <Toggle key={d.key} label={d.label} checked={Boolean(v)} onChange={(x) => onChange(d.key, x)} />;
          case 'select':
            return <Select key={d.key} label={d.label} value={String(v)} options={d.options} onChange={(x) => onChange(d.key, x)} />;
          case 'text':
            return <TextField key={d.key} label={d.label} value={String(v ?? '')} placeholder={d.placeholder} onChange={(x) => onChange(d.key, x)} />;
          case 'seed':
            return (
              <div key={d.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <Slider label={d.label} min={1} max={999} step={1} value={Number(v)} onChange={(x) => onChange(d.key, x)} />
                </div>
                <IconButton label="New seed" onClick={() => onChange(d.key, Math.floor(Math.random() * 999) + 1)}>
                  <Dices size={14} />
                </IconButton>
              </div>
            );
        }
      })}
    </>
  );
}
