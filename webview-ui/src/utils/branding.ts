export const getExtensionName = (): string => {
  return __EXTENSION_NAME__;
};

export const isKonveyor = (): boolean => {
  return getExtensionName() === "konveyor";
};

export const isMTA = (): boolean => {
  return getExtensionName() === "mta";
};

export const getBrandName = (): string => {
  const extensionName = getExtensionName();
  return extensionName === "mta"
    ? "MTA"
    : extensionName === "konveyor"
      ? "Konveyor"
      : extensionName.charAt(0).toUpperCase() + extensionName.slice(1);
};

export const getBrandNameLowercase = (): string => {
  return getBrandName().toLowerCase();
};
