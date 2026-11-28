import { SvgXml } from "react-native-svg";
import { icon as sizes, useColors, type Colors } from "./theme";

// Every icon in the app is one of these, drawn by Icon: one name per meaning, the same outline on
// iOS and Android. The shapes come from IconMCP (https://iconmcp.com/library, MIT), on its 16-unit
// grid, with each one's IconMCP name above it. A new one: get_icon from its MCP server
// (https://iconmcp.com/mcp), then paste what is inside its <svg> here; the stroke is set by Icon.

// An Agent is drawn as its own head, not a stock face: the Character's chamfer shell
// (entities/character) as an outline with its top socket, and its dark screen solid with the
// eyes cut out, as the Character's screen is the darkest part of it. Drawn for Veeloe, not IconMCP.
const AGENT =
  '<path d="M4.5 4.3H11.5L14.25 7.05V11.2L11.5 13.95H4.5L1.75 11.2V7.05Z"/><line x1="8" y1="4.3" x2="8" y2="2.6"/><circle cx="8" cy="2" r="0.75" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5.6 7H10.4A1.6 1.6 0 0 1 12 8.6V10.0A1.6 1.6 0 0 1 10.4 11.6H5.6A1.6 1.6 0 0 1 4 10.0V8.6A1.6 1.6 0 0 1 5.6 7Z M6.05 8.700000000000001H6.95V9.9H6.05Z M9.05 8.700000000000001H9.95V9.9H9.05Z"/>';

const ICONS = {
  // check
  check: '<path d="M2.75 8.5 L6.25 12 L13.25 4.5"/>',
  // An Agent is waiting on a person: for an Approval, or an allowlist entry (ADR 0030).
  // hand-stop
  approval:
    '<path d="M8 3.68 L8 3.13 L7.97 2.9 L7.87 2.62 L7.71 2.39 L7.5 2.2 L7.34 2.11 L7.18 2.05 L6.89 2 L6.71 2.01 L6.51 2.05 L6.25 2.16 L6.03 2.33 L5.86 2.55 L5.75 2.79 L5.71 2.97 L5.625 3.15 L5.625 4.63 L5.65 4.64 L5.63 4.62 L5.51 4.38 L5.4 4.24 L5.28 4.12 L5.13 4.01 L4.95 3.92 L4.77 3.87 L4.58 3.85 L4.38 3.86 L4.2 3.9 L3.98 3.99 L3.79 4.12 L3.67 4.24 L3.56 4.38 L3.47 4.57 L3.41 4.74 L3.375 4.98 L3.375 9.7 L3.45 10.15 L3.54 10.58 L3.68 11 L3.88 11.47 L4.21 12.01 L4.4 12.27 L4.64 12.55 L5.06 12.95 L5.58 13.31 L6.15 13.61 L6.75 13.83 L7.31 13.95 L7.93 14 L8.38 14 L8.83 13.93 L9.25 13.83 L9.73 13.66 L10.14 13.47 L10.53 13.25 L10.94 12.95 L11.22 12.69 L11.52 12.37 L11.79 12.01 L12.03 11.64 L12.23 11.24 L12.39 10.82 L12.52 10.33 L12.625 9.89 L12.625 9.45 L12.625 7.21 L12.58 7.03 L12.52 6.86 L12.44 6.69 L12.32 6.54 L12.12 6.36 L11.85 6.22 L11.69 6.18 L11.53 6.16 L11.23 6.18 L10.97 6.26 L10.72 6.43 L10.5 6.67 L10.37 6.93 L10.34 6.94 L10.25 6.92 L10.25 3.98 L10.27 3.8 L10.22 3.64 L10.06 3.37 L9.87 3.17 L9.58 3 L9.29 2.93 L8.73 3 L8.48 3.14 L8.34 3.26 L8.23 3.38 L8.14 3.52 L8.06 3.7 L8.03 3.71 Z"/><path d="M5.75 7.54 L5.893 6.171"/><path d="M8 3.68 L8 7.08"/><path d="M8 10.77 L8.03 10.37 L8.16 9.92 L8.36 9.54 L8.62 9.2 L8.94 8.91 L9.31 8.69 L9.62 8.57 L10.06 8.46 L10.24 8.39 L10.25 8.08 L10.25 7.58 L10.47 6.71"/>',
  // shield-check
  shield: '<path d="M5 2.5 L11 2.5 A2 2 0 0 1 13 4.5 L13 6.525 C13 8.02 13 9.805 8 14 C3 9.805 3 8.02 3 6.525 L3 4.5 A2 2 0 0 1 5 2.5 Z"/><path d="M5.5 7.75 L7.25 9.5 L10.5 6.25"/>',
  agent: AGENT,
  // arrow-up
  send: '<g transform="rotate(-90 8 8)"><line x1="2.75" y1="8" x2="13.25" y2="8"/><path d="M8.5 3.25 L13.25 8 L8.5 12.75"/></g>',
  // plus
  add: '<line x1="8" y1="2.75" x2="8" y2="13.25"/><line x1="2.75" y1="8" x2="13.25" y2="8"/>',
  // Every item of something, such as all of an Agent's Tasks.
  // list-bullet
  list: '<circle cx="2.75" cy="3.25" r="0.55" fill="currentColor" stroke="none"/><circle cx="2.75" cy="9.625" r="0.55" fill="currentColor" stroke="none"/><line x1="5.5" y1="3.25" x2="13.75" y2="3.25"/><line x1="5.5" y1="6.375" x2="11" y2="6.375"/><line x1="5.5" y1="9.625" x2="13.75" y2="9.625"/><line x1="5.5" y1="12.75" x2="10" y2="12.75"/>',
  // chevron-right
  disclosure: '<path d="M5.875 3.75 L10.125 8 L5.875 12.25"/>',
  // layers
  thread:
    '<path d="M8.381 2.206 L12.701 4.547 C13.26 4.849 13.26 5.651 12.701 5.953 L8.381 8.294 C8.143 8.422 7.857 8.422 7.619 8.294 L3.299 5.953 C2.74 5.651 2.74 4.849 3.299 4.547 L7.619 2.206 C7.857 2.078 8.143 2.078 8.381 2.206 Z"/><path d="M2 8 L8 11.25 L14 8"/><path d="M2 10.75 L8 14 L14 10.75"/>',
  // inbox
  inbox:
    '<path d="M2.31 8.334 L4.011 3.658 C4.154 3.263 4.53 3 4.95 3 L11.05 3 C11.47 3 11.846 3.263 11.989 3.658 L13.69 8.334 C13.73 8.444 13.75 8.56 13.75 8.676 L13.75 12 C13.75 12.552 13.302 13 12.75 13 L3.25 13 C2.698 13 2.25 12.552 2.25 12 L2.25 8.676 C2.25 8.56 2.27 8.444 2.31 8.334 Z"/><path d="M2.25 8.5 L5.152 8.5 C5.367 8.5 5.566 8.615 5.673 8.802 L6.327 9.948 C6.434 10.135 6.633 10.25 6.848 10.25 L9.152 10.25 C9.367 10.25 9.566 10.135 9.673 9.948 L10.327 8.802 C10.434 8.615 10.633 8.5 10.848 8.5 L13.75 8.5"/>',
  // clock
  time: '<circle cx="8" cy="8" r="6"/><path d="M8 4.75 L8 8 L10.5 9.5"/>',
  // info
  info: '<circle cx="8" cy="8" r="6"/><line x1="8" y1="7.25" x2="8" y2="11"/><circle cx="8" cy="4.85" r="0.55" fill="currentColor" stroke="none"/>',
  // wifi-off
  offline:
    '<path d="M2.05 5.75 A9 9 0 0 1 2.947 5.055 M5.816 3.772 A9 9 0 0 1 13.95 5.75"/><path d="M3.53 8.5 A6 6 0 0 1 5.138 7.229 M8.451 6.519 A6 6 0 0 1 12.47 8.5"/><path d="M5.56 10.75 A3 3 0 0 1 7.549 9.53"/><circle cx="8" cy="12.5" r="0.55" fill="currentColor" stroke="none"/><line x1="2.75" y1="2.75" x2="13.25" y2="13.25"/>',
  // settings
  settings:
    '<path d="M6.663 3.269 L6.631 2.646 C6.611 2.246 6.93 1.91 7.33 1.91 L8.67 1.91 C9.07 1.91 9.389 2.246 9.369 2.646 L9.337 3.269 C9.324 3.532 9.459 3.779 9.686 3.911 L10.698 4.495 C10.926 4.626 11.208 4.619 11.428 4.476 L11.953 4.137 C12.289 3.92 12.739 4.028 12.939 4.375 L13.609 5.535 C13.809 5.882 13.678 6.326 13.322 6.508 L12.766 6.793 C12.532 6.912 12.385 7.153 12.385 7.416 L12.385 8.584 C12.385 8.847 12.532 9.088 12.766 9.207 L13.322 9.492 C13.678 9.674 13.809 10.118 13.609 10.465 L12.939 11.625 C12.739 11.972 12.289 12.08 11.953 11.863 L11.428 11.524 C11.208 11.381 10.926 11.374 10.698 11.505 L9.686 12.089 C9.459 12.221 9.324 12.468 9.337 12.731 L9.369 13.354 C9.389 13.754 9.07 14.09 8.67 14.09 L7.33 14.09 C6.93 14.09 6.611 13.754 6.631 13.354 L6.663 12.731 C6.676 12.468 6.541 12.221 6.314 12.089 L5.302 11.505 C5.074 11.374 4.792 11.381 4.572 11.524 L4.047 11.863 C3.711 12.08 3.261 11.972 3.061 11.625 L2.391 10.465 C2.191 10.118 2.322 9.674 2.678 9.492 L3.234 9.207 C3.468 9.088 3.615 8.847 3.615 8.584 L3.615 7.416 C3.615 7.153 3.468 6.912 3.234 6.793 L2.678 6.508 C2.322 6.326 2.191 5.882 2.391 5.535 L3.061 4.375 C3.261 4.028 3.711 3.92 4.047 4.137 L4.572 4.476 C4.792 4.619 5.074 4.626 5.302 4.495 L6.314 3.911 C6.541 3.779 6.676 3.532 6.663 3.269 Z"/><circle cx="8" cy="8" r="2"/>',
  // monitor
  machine: '<rect x="1.75" y="2.5" width="12.5" height="8.5" rx="2"/><line x1="8" y1="11" x2="8" y2="13.5"/><line x1="5.25" y1="13.5" x2="10.75" y2="13.5"/>',
  // key
  key: '<circle cx="5" cy="11" r="3"/><line x1="7.12" y1="8.88" x2="13.5" y2="2.5"/><line x1="11.5" y1="4.5" x2="13.25" y2="6.25"/><line x1="9.25" y1="6.75" x2="10.75" y2="8.25"/>',
  // lock
  lock: '<path d="M5.25 7 V5 A2.75 2.75 0 0 1 10.75 5 V7"/><rect x="3" y="7" width="10" height="7" rx="2"/><line x1="8" y1="9.75" x2="8" y2="11.25"/>',
  // alert
  warning:
    '<path d="M9.311 4.36 L13.012 11.022 C13.567 12.021 12.844 13.25 11.701 13.25 L4.299 13.25 C3.156 13.25 2.433 12.021 2.988 11.022 L6.689 4.36 C7.26 3.332 8.74 3.332 9.311 4.36 Z"/><line x1="8" y1="6.25" x2="8" y2="8.75"/><circle cx="8" cy="10.9" r="0.55" fill="currentColor" stroke="none"/>',
  // circle-check
  done: '<circle cx="8" cy="8" r="6"/><path d="M5.25 8.25 L7.25 10.25 L10.75 6.25"/>',
  // x-circle
  failed: '<circle cx="8" cy="8" r="6"/><line x1="5.75" y1="5.75" x2="10.25" y2="10.25"/><line x1="10.25" y1="5.75" x2="5.75" y2="10.25"/>',
  // stop-circle
  stopped: '<circle cx="8" cy="8" r="6"/><rect x="5.5" y="5.5" width="5" height="5" rx="0.8"/>',
  // chevron-down
  expand: '<g transform="rotate(90 8 8)"><path d="M5.875 3.75 L10.125 8 L5.875 12.25"/></g>',
  // chevron-up
  collapse: '<g transform="rotate(-90 8 8)"><path d="M5.875 3.75 L10.125 8 L5.875 12.25"/></g>',
  // globe
  network: '<circle cx="8" cy="8" r="6"/><line x1="2" y1="8" x2="14" y2="8"/><ellipse cx="8" cy="8" rx="2.5" ry="6"/>',
  // folder
  folder:
    '<path d="M4.25 3.25 L5.33 3.25 C5.914 3.25 6.469 3.505 6.849 3.948 L7.151 4.302 C7.531 4.745 8.086 5 8.67 5 L11.75 5 C12.855 5 13.75 5.895 13.75 7 L13.75 10.75 C13.75 11.855 12.855 12.75 11.75 12.75 L4.25 12.75 C3.145 12.75 2.25 11.855 2.25 10.75 L2.25 5.25 C2.25 4.145 3.145 3.25 4.25 3.25 Z"/>',
  // smartphone
  device: '<rect x="4" y="1.75" width="8" height="12.5" rx="2"/><line x1="7" y1="11.75" x2="9" y2="11.75"/>',
  // user-group
  people:
    '<circle cx="8" cy="5.5" r="2"/><path d="M4.5 13.5 C4.9 11.5 6.3 10 8 10 C9.7 10 11.1 11.5 11.5 13.5"/><path d="M4.25 3.75 A2 2 0 0 0 4.25 7.75"/><path d="M11.75 3.75 A2 2 0 0 1 11.75 7.75"/><path d="M3.75 10 C2.75 10.5 2.1 11.75 1.75 13.25"/><path d="M12.25 10 C13.25 10.5 13.9 11.75 14.25 13.25"/>',
  // bar-chart
  usage: '<rect x="2.25" y="8.5" width="2" height="5" rx="0.6"/><rect x="7" y="2.5" width="2" height="11" rx="0.6"/><rect x="11.75" y="5.5" width="2" height="8" rx="0.6"/>',
  // trash
  trash:
    '<path d="M3.5 4.25 L4.105 11.907 C4.187 12.948 5.055 13.75 6.098 13.75 L9.902 13.75 C10.945 13.75 11.813 12.948 11.895 11.907 L12.5 4.25"/><line x1="2.25" y1="4.25" x2="13.75" y2="4.25"/><path d="M6 4.25 L6 3.25 C6 2.698 6.448 2.25 7 2.25 L9 2.25 C9.552 2.25 10 2.698 10 3.25 L10 4.25"/><line x1="6.75" y1="7" x2="6.75" y2="11"/><line x1="9.25" y1="7" x2="9.25" y2="11"/>',
  // brain
  memory:
    '<path d="M8 3.5 A2.25 2.25 0 0 0 4 4.25 A2.5 2.5 0 0 0 2.75 8.5 A2.5 2.5 0 0 0 5 12.75 A2 2 0 0 0 8 13"/><path d="M8 3.5 A2.25 2.25 0 0 1 12 4.25 A2.5 2.5 0 0 1 13.25 8.5 A2.5 2.5 0 0 1 11 12.75 A2 2 0 0 1 8 13"/><line x1="8" y1="3.5" x2="8" y2="13"/>',
  // refresh
  refresh: '<path d="M13.75 8 A5.75 5.75 0 1 1 8 2.25 C9.6 2.25 11.1 2.9 12.25 4 L13.75 5.5"/><path d="M13.75 2.25 L13.75 5.5 L10.5 5.5"/>',
  // edit
  edit: '<path d="M10.957 3.457 L12.543 5.043 C12.933 5.433 12.933 6.067 12.543 6.457 L5.793 13.207 C5.605 13.395 5.351 13.5 5.086 13.5 L2.5 13.5 L2.5 10.914 C2.5 10.649 2.605 10.395 2.793 10.207 L9.543 3.457 C9.933 3.067 10.567 3.067 10.957 3.457 Z"/><line x1="8.75" y1="4.25" x2="11.75" y2="7.25"/>',
  // Draw a new random look.
  // dice-5
  shuffle:
    '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="5" cy="5" r="0.55" fill="currentColor" stroke="none"/><circle cx="11" cy="5" r="0.55" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="0.55" fill="currentColor" stroke="none"/><circle cx="5" cy="11" r="0.55" fill="currentColor" stroke="none"/><circle cx="11" cy="11" r="0.55" fill="currentColor" stroke="none"/>',
  // An Agent's Character, as a head.
  character: AGENT,
  // file-text
  file: '<path d="M5.25 2 L9 2 L12.75 5.75 L12.75 12 C12.75 13.105 11.855 14 10.75 14 L5.25 14 C4.145 14 3.25 13.105 3.25 12 L3.25 4 C3.25 2.895 4.145 2 5.25 2 Z"/><path d="M9 2 L9 4.75 C9 5.302 9.448 5.75 10 5.75 L12.75 5.75"/><line x1="5.5" y1="5.75" x2="7" y2="5.75"/><line x1="5.5" y1="8.5" x2="10.5" y2="8.5"/><line x1="5.5" y1="11" x2="10.5" y2="11"/>',
  // share-square
  share:
    '<path d="M5.25 7 L4.125 7 C3.504 7 3 7.504 3 8.125 L3 12 C3 13.105 3.895 14 5 14 L11 14 C12.105 14 13 13.105 13 12 L13 8.125 C13 7.504 12.496 7 11.875 7 L10.75 7"/><line x1="8" y1="2" x2="8" y2="9.75"/><path d="M5.5 4.5 L8 2 L10.5 4.5"/>',
  // face-recognition
  faceId:
    '<path d="M2.25 5.25 L2.25 3.45 C2.25 2.787 2.787 2.25 3.45 2.25 L5.25 2.25"/><path d="M13.75 10.75 L13.75 12.55 C13.75 13.213 13.213 13.75 12.55 13.75 L10.75 13.75"/><path d="M5.25 13.75 L3.45 13.75 C2.787 13.75 2.25 13.213 2.25 12.55 L2.25 10.75"/><path d="M12.5 1.75 Q12.5 3.5 14.25 3.5 Q12.5 3.5 12.5 5.25 Q12.5 3.5 10.75 3.5 Q12.5 3.5 12.5 1.75 Z"/><circle cx="8" cy="6" r="1.75"/><path d="M5.5 11.75 C5.9 10.5 6.8 9.75 8 9.75 C9.2 9.75 10.1 10.5 10.5 11.75"/>',
  // hard-drive
  storage: '<rect x="1.75" y="4" width="12.5" height="8" rx="2"/><line x1="4.5" y1="8" x2="7.5" y2="8"/><circle cx="11" cy="8" r="0.55" fill="currentColor" stroke="none"/>',
  // sliders
  sliders:
    '<line x1="2.25" y1="4.75" x2="7.75" y2="4.75"/><circle cx="9.75" cy="4.75" r="2"/><line x1="11.75" y1="4.75" x2="13.75" y2="4.75"/><line x1="2.25" y1="11.25" x2="4.25" y2="11.25"/><circle cx="6.25" cy="11.25" r="2"/><line x1="8.25" y1="11.25" x2="13.75" y2="11.25"/>',
  // qr-code
  qr: '<rect x="2.25" y="2.25" width="4.5" height="4.5" rx="0.8"/><rect x="9.25" y="2.25" width="4.5" height="4.5" rx="0.8"/><rect x="2.25" y="9.25" width="4.5" height="4.5" rx="0.8"/><circle cx="10.25" cy="10.25" r="0.55" fill="currentColor" stroke="none"/><circle cx="12.75" cy="10.25" r="0.55" fill="currentColor" stroke="none"/><circle cx="10.25" cy="12.75" r="0.55" fill="currentColor" stroke="none"/><circle cx="12.75" cy="12.75" r="0.55" fill="currentColor" stroke="none"/>',
  // terminal
  terminal: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M4.5 6 L6.5 8 L4.5 10"/><line x1="8" y1="10" x2="11" y2="10"/>',
  // search
  search: '<circle cx="7" cy="7" r="4.75"/><line x1="10.375" y1="10.375" x2="13.75" y2="13.75"/>',
  // more-horizontal
  more: '<circle cx="3" cy="8" r="1.25" fill="currentColor" fill-rule="evenodd" stroke="none"/><circle cx="8" cy="8" r="1.25" fill="currentColor" fill-rule="evenodd" stroke="none"/><circle cx="13" cy="8" r="1.25" fill="currentColor" fill-rule="evenodd" stroke="none"/>',
  // external-link
  external:
    '<path d="M7 2.75 L4.75 2.75 C3.645 2.75 2.75 3.645 2.75 4.75 L2.75 11.25 C2.75 12.355 3.645 13.25 4.75 13.25 L11.25 13.25 C12.355 13.25 13.25 12.355 13.25 11.25 L13.25 9"/><line x1="7.5" y1="8.5" x2="13.25" y2="2.75"/><path d="M9.25 2.75 L13.25 2.75 L13.25 6.75"/>',
  // git-branch
  branch: '<line x1="4.75" y1="2" x2="4.75" y2="9.5"/><circle cx="4.75" cy="11.25" r="1.75"/><circle cx="11.25" cy="4.75" r="1.75"/><path d="M11.25 6.5 A4.75 4.75 0 0 1 6.5 11.25"/>',
};

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: keyof typeof sizes;
  color?: keyof Colors;
  weight?: "regular" | "semibold";
}

// Decorative by default: an icon sits beside words that say the same thing,
// and a control that is only an icon carries its own aria-label.
export function Icon({ name, size = "sm", color = "secondaryLabel", weight }: Props) {
  const colors = useColors();
  const px = sizes[size];
  // A sixteenth of the icon from 20pt up, and no thinner than 1.25pt below it so a small one
  // does not fade; semibold sits beside bold words, in a button or on a chevron.
  const stroke = Math.max(1, 20 / px) * (weight === "semibold" ? 1.3 : 1);
  const xml = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return <SvgXml aria-hidden xml={xml} width={px} height={px} color={colors[color]} />;
}
