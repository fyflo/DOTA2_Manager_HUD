const p1 = "rgba(52, 118, 255, 1.0)";
const p2 = "rgba(103, 255, 192, 1.0)";
const p3 = "rgba(192, 0, 192, 1.0)";
const p4 = "rgba(243, 240, 12, 1.0)";
const p5 = "rgba(255, 108, 0, 1.0)";
const p6 = "rgba(254, 135, 195, 1.0)";
const p7 = "rgba(162, 181, 72, 1.0)";
const p8 = "rgba(102, 217, 247, 1.0)";
const p9 = "rgba(0, 132, 34, 1.0)";
const p10 = "rgba(165, 106, 0, 1.0)";
const radiant_left = "rgba(125, 213, 77, 1.0)";
const diant_right = "rgba(227, 78, 49, 1.0)";

const HUD_NAME = "Default_HUD";


function updatePage(data) {
  //console.log(data);

  
  // Проверка наличия необходимых данных
  if (!data || !data.map) {
    return;
  }

  const GAME_STATE = {
    HERO_SELECTION: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    STRATEGY_TIME: "DOTA_GAMERULES_STATE_STRATEGY_TIME",
    TEAM_SHOWCASE: "DOTA_GAMERULES_STATE_TEAM_SHOWCASE",
    Waiting_players: "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD",
    PRE_GAME: "DOTA_GAMERULES_STATE_PRE_GAME",
    POST_GAME: "DOTA_GAMERULES_STATE_POST_GAME",
  };

  const ELEMENTS_TO_TOGGLE = [
    "#observed",
    "#players_left",
    "#players_right",
    "#top_panel",
    "#draft",
    "#roshan",
    "#couriers",
    "#buyback_container",
  ];

  function toggleElementsVisibility(data) {
    const gameState = data.map.game_state;
    const opacity =
      gameState === GAME_STATE.HERO_SELECTION ||
      gameState === GAME_STATE.STRATEGY_TIME ||
      gameState === GAME_STATE.TEAM_SHOWCASE ||
      gameState === GAME_STATE.Waiting_players ||
      gameState === GAME_STATE.POST_GAME
        ? 0
        : 1;

    ELEMENTS_TO_TOGGLE.forEach((selector) => {
      $(selector).css("opacity", opacity);
    });
  }

  const ELEMENTS_TO_TOGGLE2 = ["#draft"];

  function toggleElementsVisibility2(data) {
    const gameState = data.map.game_state;
    const opacity =
      gameState === GAME_STATE.HERO_SELECTION ||
      gameState === GAME_STATE.STRATEGY_TIME /*||
      gameState === GAME_STATE.PRE_GAME*/
        ? 1
        : 0;

    ELEMENTS_TO_TOGGLE2.forEach((selector) => {
      $(selector).css("opacity", opacity);
    });
  }
  const ELEMENTS_TO_TOGGLE3 = [
    "#pick_ban",
    "#current_time.timer.active",
    ".reserve",
    "#side_name",
  ];

  function toggleElementsVisibility3(data) {
    const gameState = data.map.game_state;
    const opacity = gameState === GAME_STATE.STRATEGY_TIME ? 0 : 1;

    ELEMENTS_TO_TOGGLE3.forEach((selector) => {
      $(selector).css("opacity", opacity);
    });
  }

  // Заменить существующий if-else блок на:
  toggleElementsVisibility(data);
  toggleElementsVisibility2(data);
  toggleElementsVisibility3(data);

  updateObserver(data.observer, data.players, data.map);
  updateTopPanel(data.league, data.dota);
  abilitiesUlta(data.abilities, data.players);

}


function abilitiesUlta(abilities, players){
  // Проверка на существование объекта abilities
  if (!abilities) return;
  
  for (let player = 0; player < 10; player++) {
    // Определяем команду и номер игрока
    const team = player < 5 ? "team2" : "team3";
    const playerNum = player < 5 ? player : player - 5;

    // Проверка наличия команды и игрока в объекте abilities
    if (!abilities[team] || !abilities[team][`player${player}`]) continue;

    // HTML элементы нумеруются с 1 до 10, а игроки с 0 до 9
    const uiIndex = player + 1;

    // Проверяем способности от 0 до 8 для каждого игрока
    for (let i = 0; i < 9; i++) {
      const ability = abilities[team][`player${player}`][`ability${i}`];

      // Если находим ульту
      if (ability && ability.ultimate === true) {
        //console.log(`Найдена ульта игрока ${player}: ${ability.name}`);

        // Отображаем название ульты для конкретного игрока
        $(`#ultimate_name_${uiIndex}`).text(ability.name);

        // Проверяем кулдаун
        if (ability.cooldown !== 0) {
          // Если кулдаун не 0, показываем картинку и значение кулдауна
          $(`#ultimate_image_${uiIndex}`)
            .attr({
              src: `/images/dota2/abilities/${ability.name}.webp`,
              alt: ability.name,
            })
            .show();
          $(`#ultimate_cooldown_${uiIndex}`)
            .text(Math.ceil(ability.cooldown))
            .show();
        } else {
          // Если кулдаун 0, скрываем картинку и значение кулдауна
          $(`#ultimate_image_${uiIndex}`).hide();
          $(`#ultimate_cooldown_${uiIndex}`).hide();
        }

        break; // Переходим к следующему игроку после нахождения ульты
      }
    }
  }
}

function updateTopPanel(league, dota) {
  // Проверка логотипа Radiant команды
  if (dota && dota.radiant_team && dota.radiant_team.logo) {
    $("#left_team #team_logo").attr("src", `/uploads/${dota.radiant_team.logo}`);
  } else {
    $("#left_team #team_logo").attr("src", "/images/elements/logo_left_default.webp");
  }

  // Проверка логотипа Dire команды
  if (dota && dota.dire_team && dota.dire_team.logo) {
    $("#right_team #team_logo").attr("src", `/uploads/${dota.dire_team.logo}`);
  } else {
    $("#right_team #team_logo").attr("src", "/images/elements/logo_right_default.webp");
  }

  // Проверка имени Radiant команды
  if (dota && dota.radiant_team && dota.radiant_team.name) {
    $("#left_team #main").text(dota.radiant_team.name);
  } else if (league && league.radiant && league.radiant.name) {
    $("#left_team #main").text(league.radiant.name);
  } else {
    $("#left_team #main").text("Radiant");
  }

  // Проверка имени Dire команды
  if (dota && dota.dire_team && dota.dire_team.name) {
    $("#right_team #main").text(dota.dire_team.name);
  } else if (league && league.dire && league.dire.name) {
    $("#right_team #main").text(league.dire.name);
  } else {
    $("#right_team #main").text("Dire");
  }
}


function updateObserver(observed, players, map) {
  // Проверка существования объекта observed
  if (!observed) {
    $("#observed").css("opacity", "0");
    return;
  } else {
    $("#observed").css("opacity", "1");
  }


  $("#obs_alias_text").text(observed.name);
  
  // Проверяем наличие аватара
  if (observed.avatar) {
    // Если аватар есть, устанавливаем его и убираем класс отсутствия аватара
    $("#obs_avatar_img")
      .attr("src", `/uploads/${observed.avatar}`)
      .css("opacity", "1")
      .removeClass("obs_img_no_avatar");
  } else {
    // Если аватара нет, добавляем класс отсутствия аватара
    $("#obs_avatar_img")
    .attr("src", `/images/player_silhouette.webp`)
  }
}


//-------------------------------------------------------------------------------
// Подписываемся на обновления GSI
gsiManager.subscribe((event) => {
  switch(event.type) {
      case 'update':
          updatePage(event.data); // Изменено с updateHUD на updatePage
          break;
  }
});


