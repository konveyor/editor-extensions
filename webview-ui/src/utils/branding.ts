export const getBranding = () => __BRANDING__;

export const getExtensionName = (): string => {
  return __BRANDING__.extensionName;
};

export const isKonveyor = (): boolean => {
  return __BRANDING__.extensionName === "konveyor";
};

export const isMTA = (): boolean => {
  return __BRANDING__.extensionName === "mta";
};

export const getBrandName = (): string => {
  return __BRANDING__.productName;
};

export const getBrandNameLowercase = (): string => {
  return __BRANDING__.productNameLowercase;
};
