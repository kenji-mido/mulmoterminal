import { computed, type Ref } from "vue";
import { useDirConfig } from "./useDirConfig";
import { cellStyleFor, headerStyleFor } from "../components/cellHeaderStyle";

// A grid cell's directory-driven chrome, in one place: the config, the frame's CSS variables and
// the header's.
//
// Every cell type used to assemble these itself, and each new one had to remember all of it. It
// didn't: #902 found theme/font missing from the Shell and Command cells, #914 the name badge,
// #1006 the six chrome colours — the same omission three times over, because "remember to wire it
// up" WAS the design. A cell now asks for its chrome and gets all of it.
export function useCellChrome(cwd: Ref<string | null | undefined>) {
  const { config } = useDirConfig(cwd);
  return {
    config,
    // Emitted as variables rather than plain background/border, so a status tint (working /
    // blocked) still overrides while idle keeps the directory's colour.
    cellStyle: computed(() => cellStyleFor(config.value.cellColor, config.value.cellBorderColor, config.value.dotColor, config.value.buttonColor)),
    // The cells that take their header style from here (CellShell's command / launcher cells)
    // paint the directory's colour in every state. TerminalCell is the exception — a status
    // replaces its header background, so it resolves its own per status.
    headerStyle: computed(() => headerStyleFor(config.value.headerColor, config.value.headerTextColor)),
  };
}
