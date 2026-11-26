// The ICT overlay's UI: ui.mjs's factory bound to the ICT inputs, ids and texts (slot 0: its button sits first).
import { createUi } from './ui.mjs';
import { INPUTS, defaultValues, isValidValue } from './inputs.mjs';

export const ictUi = createUi({
  prefix: 'thndrx-ict', buttonText: 'ICT', buttonTitle: 'ICT + RSI/MA Confluence settings',
  title: 'ICT + RSI/MA Confluence · Settings', inputs: INPUTS, defaults: defaultValues, isValid: isValidValue, slot: 0,
});
export const renderPanel = ictUi.renderPanel;
export const mountButton = ictUi.mountButton;
export const hasButton = ictUi.hasButton;
export const openSettings = ictUi.openSettings;
export const placeUi = ictUi.placeUi;
export const unmountUi = ictUi.unmountUi;
