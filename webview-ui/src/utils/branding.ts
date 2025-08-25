export const getPublisher = (): string => {
  return __PUBLISHER__;
};

export const isKonveyor = (): boolean => {
  return getPublisher() === "konveyor";
};

export const isMTA = (): boolean => {
  return getPublisher() === "mta";
};

export const getBrandName = (): string => {
  return __BRAND_NAME__;
};

export const getBrandNameLowercase = (): string => {
  return getBrandName().toLowerCase();
};
