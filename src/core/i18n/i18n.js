import { en } from './en.js';
import { zh } from './zh.js';
import { beeNamesEn, beeNamesZh } from './beeNames.js';

export class I18n {
  constructor() {
    this.currentLanguage = 'en';
    this.languages = {
      en,
      zh
    };
    this.beeNames = {
      en: beeNamesEn,
      zh: beeNamesZh
    };
  }

  setLanguage(lang) {
    if (this.languages[lang]) {
      this.currentLanguage = lang;
      localStorage.setItem('beeBreedingLanguage', lang);
      return true;
    }
    return false;
  }

  getLanguage() {
    return this.currentLanguage;
  }

  t(key) {
    const keys = key.split('.');
    let value = this.languages[this.currentLanguage];
    
    for (const k of keys) {
      if (value[k] === undefined) {
        return key; // Return the key if translation not found
      }
      value = value[k];
    }
    
    return value;
  }

  getBeeName(beeId) {
    const names = this.beeNames[this.currentLanguage];
    if (names && names[beeId]) {
      return names[beeId];
    }
    return null;
  }

  loadSavedLanguage() {
    const savedLang = localStorage.getItem('beeBreedingLanguage');
    if (savedLang && this.languages[savedLang]) {
      this.currentLanguage = savedLang;
    }
  }

  getAvailableLanguages() {
    return Object.keys(this.languages);
  }
}