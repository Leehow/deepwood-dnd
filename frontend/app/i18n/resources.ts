import enCommon from './locales/en-US/common.json';
import enAuth from './locales/en-US/auth.json';
import enHome from './locales/en-US/home.json';
import zhCommon from './locales/zh-CN/common.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhHome from './locales/zh-CN/home.json';

export const resources = {
  'en-US': {
    common: enCommon,
    auth: enAuth,
    home: enHome,
  },
  'zh-CN': {
    common: zhCommon,
    auth: zhAuth,
    home: zhHome,
  },
} as const;
