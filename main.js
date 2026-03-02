class LottoGenerator extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });

        const template = document.createElement('template');
        template.innerHTML = `
            <style>
                .wrapper {
                    padding: 20px;
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    text-align: center;
                    background-color: #fff;
                }
                button {
                    padding: 10px 20px;
                    font-size: 16px;
                    cursor: pointer;
                    border: none;
                    border-radius: 4px;
                    background-color: #007bff;
                    color: #fff;
                    margin-bottom: 20px;
                }
                .numbers {
                    display: flex;
                    justify-content: center;
                    gap: 10px;
                }
                .number {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background-color: #f0f0f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    font-weight: bold;
                }
            </style>
            <div class="wrapper">
                <button>Generate Numbers</button>
                <div class="numbers"></div>
            </div>
        `;

        shadow.appendChild(template.content.cloneNode(true));

        const button = shadow.querySelector('button');
        const numbersContainer = shadow.querySelector('.numbers');

        button.addEventListener('click', () => {
            const numbers = this.generateNumbers();
            this.displayNumbers(numbers);
        });
    }

    generateNumbers() {
        const numbers = new Set();
        while (numbers.size < 6) {
            const randomNumber = Math.floor(Math.random() * 45) + 1;
            numbers.add(randomNumber);
        }
        return Array.from(numbers);
    }

    displayNumbers(numbers) {
        const numbersContainer = this.shadowRoot.querySelector('.numbers');
        numbersContainer.innerHTML = '';
        numbers.forEach(number => {
            const numberElement = document.createElement('div');
            numberElement.classList.add('number');
            numberElement.textContent = number;
            numbersContainer.appendChild(numberElement);
        });
    }
}

customElements.define('lotto-generator', LottoGenerator);