import { extensionLongName, extensionShortName } from '../utilities/utils';

const coreExtensionChannel =
  extensionShortName === 'Konveyor'
    ? `${extensionLongName} Core Extension`
    : `${extensionLongName} - Core`;

export const OutputChannels = {
  CoreExtension: coreExtensionChannel,
  ExtensionHost: 'Extension Host',
} as const;
