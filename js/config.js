// ============================================================
//  FORGED ARENA — конфигурация и характеристики
// ============================================================

export const MAP_SIZE = 640;
export const HALF_MAP = 320;
export const UNIT_CAP = 60;      // макс. мобильных юнитов у каждой стороны
export const BUILD_BOUND = 292;  // предел для застройки
export const UNIT_BOUND = 258;   // предел движения юнитов

export const TEAM_PLAYER = 0;
export const TEAM_ENEMY = 1;

export const TEAM_STYLE = [
  // Фракция игрока — «Вангард» (зелёный)
  { name: 'ВАНГАРД', hull: 0x3d4a52, hull2: 0x2b353c, trim: 0x1f8a56, glow: 0x49ffa0, icon: '#4dffa0', wire: 0x49ffa0 },
  // Фракция врага — «Осколок» (красно-оранжевый)
  { name: 'ОСКОЛОК', hull: 0x4d3b35, hull2: 0x3a2c28, trim: 0x9a3a28, glow: 0xff7a55, icon: '#ff7a55', wire: 0xff7a55 },
];

export const SPAWNS = [
  { x: -210, z: 210 },
  { x: 210, z: -210 },
];

// ------------------------------------------------------------
//  Характеристики сущностей
//  cost — цена (списывается постепенно при строительстве),
//  bt   — время постройки/производства в секундах при полном снабжении
// ------------------------------------------------------------
export const DEFS = {
  acu: {
    key: 'acu', name: 'Командир (ACU)', kind: 'unit', acu: true,
    cost: { m: 0, e: 0 }, bt: 1, hp: 6000, radius: 2.3, height: 4.4, vision: 44, speed: 9.5,
    weapon: { dmg: 40, range: 32, rof: 1.1, pSpeed: 85, height: 3.0 },
    income: { m: 1, e: 12 }, buildRange: 17,
    desc: 'Строит здания и защищает себя. Гибель ACU — поражение (с ядерным взрывом).',
  },

  extractor: {
    key: 'extractor', name: 'Экстрактор массы', kind: 'building',
    cost: { m: 140, e: 320 }, bt: 10, hp: 520, size: { w: 6, d: 6 }, height: 4.2, vision: 20,
    income: { m: 3.5, e: 0 }, onMass: true, hotkey: '1',
    desc: '+3.5 массы/с. Строится только на залежах массы (зелёные кристаллы).',
  },
  pgen: {
    key: 'pgen', name: 'Генератор энергии', kind: 'building',
    cost: { m: 90, e: 220 }, bt: 8, hp: 400, size: { w: 5, d: 5 }, height: 4.6, vision: 18,
    income: { m: 0, e: 16 }, hotkey: '2',
    desc: '+16 энергии/с. Энергия нужна заводам и стройке.',
  },
  factory: {
    key: 'factory', name: 'Наземный завод', kind: 'building', factory: true,
    cost: { m: 320, e: 1100 }, bt: 18, hp: 1600, size: { w: 9, d: 9 }, height: 6.5, vision: 26,
    hotkey: '3',
    desc: 'Производит наземные юниты. ЛКМ по кнопке — в очередь, ПКМ по земле — точка сбора.',
  },
  turret: {
    key: 'turret', name: 'Турель обороны', kind: 'building',
    cost: { m: 160, e: 520 }, bt: 9, hp: 900, size: { w: 4, d: 4 }, height: 3.4, vision: 47,
    weapon: { dmg: 30, range: 48, rof: 1.0, pSpeed: 95, height: 2.4 },
    hotkey: '4',
    desc: 'Автоматическая пушка для обороны базы.',
  },

  tank: {
    key: 'tank', name: '«Страж» — танк', kind: 'unit',
    cost: { m: 95, e: 180 }, bt: 7, hp: 260, radius: 1.6, height: 1.9, vision: 34, speed: 13,
    weapon: { dmg: 16, range: 27, rof: 0.8, pSpeed: 70, height: 1.5 },
    hotkey: '1', desc: 'Быстрый основной боевой танк.',
  },
  heavy: {
    key: 'heavy', name: '«Молот» — тяжёлый танк', kind: 'unit',
    cost: { m: 240, e: 520 }, bt: 14, hp: 720, radius: 2.1, height: 2.5, vision: 36, speed: 9,
    weapon: { dmg: 48, range: 31, rof: 0.6, pSpeed: 75, height: 2.0 },
    hotkey: '2', desc: 'Тяжёлая броня и мощное орудие.',
  },
  arty: {
    key: 'arty', name: '«Гроза» — артиллерия', kind: 'unit',
    cost: { m: 170, e: 700 }, bt: 12, hp: 150, radius: 1.7, height: 2.3, vision: 40, speed: 7,
    weapon: { dmg: 70, aoe: 10, range: 80, rof: 0.18, pSpeed: 0, arc: true, height: 1.7 }, minRange: 16,
    hotkey: '3', desc: 'Дальний навесной огонь по площади. Уязвима в ближнем бою.',
  },
};

export const BUILD_MENU = ['extractor', 'pgen', 'factory', 'turret'];
export const PROD_MENU = ['tank', 'heavy', 'arty'];

export const DIFFICULTIES = {
  easy:   { key: 'easy',   name: 'Легко',   eco: 0.8,  first: 135, interval: 95, size: 3, growth: 1.5, startUnits: 0,
            desc: 'ИИ медленно развивается и присылает небольшие волны.' },
  normal: { key: 'normal', name: 'Норма',   eco: 1.0,  first: 100, interval: 75, size: 4, growth: 2,   startUnits: 0,
            desc: 'Сбалансированная партия: ИИ строит базу и давит волнами.' },
  hard:   { key: 'hard',   name: 'Сложно',  eco: 1.25, first: 70,  interval: 58, size: 5, growth: 3,   startUnits: 2,
            desc: 'ИИ богаче, агрессивнее и начинает с танками.' },
};

export const ICON_DIST = 250; // дистанция камеры, выше которой включаются стратегические иконки
