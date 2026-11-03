import { useEffect, type RefObject } from "react";
// MIT source from kwlck/liquid-glass-web, commit a77866771c280eb3edfc108111a01541db6634dc.
import { createLiquidGlass } from "./vendor/liquid-glass/liquid-glass.js";
import "./vendor/liquid-glass/liquid-glass.css";

export function useLiquidChrome(
  toolbar: RefObject<HTMLDivElement | null>,
  actions: RefObject<HTMLDivElement | null>,
  visible: boolean,
) {
  useEffect(() => {
    if (!visible || !toolbar.current || !actions.current) return;
    const bar = toolbar.current;
    const controls = actions.current;
    const opaque = window.matchMedia(
      "(prefers-reduced-transparency: reduce), (prefers-contrast: more)",
    );
    let dispose: (() => void) | undefined;

    const sync = () => {
      dispose?.();
      dispose = undefined;
      if (opaque.matches) return;

      const palette = createLiquidGlass(bar, {
        radius: 20,
        mode: "css",
        blur: 7,
        light: 10,
        pointer: false,
      });
      const navigation = createLiquidGlass(controls, {
        mode: "css",
        radius: 17,
        blur: 8,
        light: 6,
        pointer: false,
      });
      dispose = () => {
        palette.destroy();
        navigation.destroy();
      };
    };
    sync();
    opaque.addEventListener("change", sync);
    return () => {
      opaque.removeEventListener("change", sync);
      dispose?.();
    };
  }, [toolbar, actions, visible]);
}
