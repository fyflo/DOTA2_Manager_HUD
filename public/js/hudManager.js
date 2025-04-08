// Создаем локальный объект для HUD
const hudManager = {
    socket: null,
    currentMatch: null,

    init: function() {
        // Подписываемся на обновления GSI
        if (window.gsiManager) {
            window.gsiManager.subscribe((data) => {
                this.handleGSIData(data);
            });
        }

        // Обработка данных GSI
        this.handleGSIData = (data) => {
            if (!data || !data.map) return;

            try {
                // Обновляем названия команд и счет
                if (data.map.team_ct && data.map.team_t) {
                    const ctName = document.querySelector('.ct-name');
                    const tName = document.querySelector('.t-name');
                    const ctScore = document.querySelector('.ct-score');
                    const tScore = document.querySelector('.t-score');

                    if (ctName) ctName.textContent = data.map.team_ct.name;
                    if (tName) tName.textContent = data.map.team_t.name;
                    if (ctScore) ctScore.textContent = data.map.team_ct.score;
                    if (tScore) tScore.textContent = data.map.team_t.score;
                }

                // Обновляем информацию о раунде
                if (data.map.round !== undefined) {
                    const roundElement = document.querySelector('.round');
                    if (roundElement) {
                        roundElement.textContent = `Round ${data.map.round}`;
                    }
                }

                // Обновляем таймер
                if (data.phase_countdowns) {
                    const timeLeft = Math.max(0, Math.ceil(data.phase_countdowns.phase_ends_in));
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = timeLeft % 60;
                    const timerElement = document.querySelector('.timer');
                    if (timerElement) {
                        timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                    }
                }

                // Обновляем игроков
                if (data.allplayers) {
                    this.updatePlayers(data.allplayers);
                }

                // Обновляем информацию о бомбе
                if (data.bomb) {
                    this.updateBomb(data.bomb);
                }

            } catch (error) {
                console.error('Ошибка при обновлении HUD:', error);
            }
        };
    },

    updatePlayers: function(players) {
        const ctContainer = document.querySelector('.team-ct');
        const tContainer = document.querySelector('.team-t');
        
        if (!ctContainer || !tContainer) return;

        ctContainer.innerHTML = '';
        tContainer.innerHTML = '';

        Object.values(players).forEach(player => {
            const playerCard = `
                <div class="player-card ${player.team.toLowerCase()}">
                    <div class="player-info">
                        <div class="player-name">${player.name}</div>
                        <div class="player-stats">
                            <span class="health">${player.state.health}</span>
                            <span class="armor">${player.state.armor}</span>
                            <span class="money">$${player.state.money}</span>
                        </div>
                    </div>
                    <div class="player-score">
                        <span class="kills">${player.match_stats.kills}</span>/
                        <span class="assists">${player.match_stats.assists}</span>/
                        <span class="deaths">${player.match_stats.deaths}</span>
                    </div>
                </div>
            `;

            if (player.team === 'CT') {
                ctContainer.insertAdjacentHTML('beforeend', playerCard);
            } else {
                tContainer.insertAdjacentHTML('beforeend', playerCard);
            }
        });
    },

    updateBomb: function(bomb) {
        const bombTimer = document.querySelector('.bomb-timer');
        if (!bombTimer) return;
        
        if (bomb.state === 'planted') {
            bombTimer.classList.remove('hidden');
            const bombProgress = document.querySelector('.bomb-progress');
            if (bombProgress) {
                bombProgress.style.animation = 'none';
                bombProgress.offsetHeight; // Форсируем reflow
                bombProgress.style.animation = 'bomb-countdown 40s linear';
            }
        } else {
            bombTimer.classList.add('hidden');
        }
    }
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    hudManager.init();
});