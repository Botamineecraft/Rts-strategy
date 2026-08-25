// ============================================================
//  Общее состояние игры (без импортов — общий корень зависимостей)
// ============================================================

function makeTeam() {
  return {
    mass: 1200, energy: 2000,
    massCap: 4000, energyCap: 6000,
    massIncome: 0, energyIncome: 0,
    massDrain: 0, energyDrain: 0,
    unitCount: 0,
  };
}

export const G = {
  scene: null, camera: null, renderer: null,
  cam: null,                    // { target: Vector3, dist }
  matBody: null, matGlow: null, // общие материалы (vertex colors)

  teams: [makeTeam(), makeTeam()],
  entities: [], units: [], buildings: [],
  selection: [],
  massPoints: [],
  acu: [null, null],
  stats: [{ kills: 0, built: 0, lost: 0 }, { kills: 0, built: 0, lost: 0 }],

  combat: null, fog: null, ai: null, input: null, ui: null, sound: null,

  time: 0,
  started: false,
  over: false,
  pendingEnd: null,   // { winner, t }
  winner: null,
  difficulty: 'normal',

  heightAt: () => 0,
  camDist: 90,
  iconMode: false,
  shake: 0,
  edgePan: true,
  pings: [],
};
