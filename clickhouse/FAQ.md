# Clickhouse Interview FAQ

## 1. Философия и отличия (OLAP vs OLTP)

### Вопрос 1.1: В чем фундаментальная разница между ClickHouse и PostgreSQL? Когда вы выберете каждую из этих СУБД?

**Контекст/Цель вопроса:**
Интервьюер проверяет понимание различий между OLAP (Online Analytical Processing) и OLTP (Online Transacion Processing) системами, умение выбирать правильный инструмент для задачи.

**Эталонный ответ:**

ClickHouse и PostgreSQL решают принципиально разные задачи из-за разной внутренней архитектуры:

| Аспект                     | ClickHouse (OLAP)                                      | PostgreSQL (OLTP)                                         |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| **Хранение данных**        | Колоночное (столбцовое)                                | Строковое                                                 |
| **Оптимизация**            | Массовое чтение, агрегации                             | Точечные чтения/записи, обновления                        |
| **Транзакции**             | Нет ACID в классическом понимании                      | Полная поддержка ACID                                     |
| **UPDATE/DELETE**          | Очень дорогие операции (мутации)                       | Нативные, быстрые операции                                |
| **Типичный запрос**        | SELECT sum(revenue) WHERE date > ... GROUP BY category | SELECT \* FROM users WHERE id = 123; UPDATE users SET ... |
| **Латентность записи**     | Миллисекунды-секунды (батчинг)                         | Микросекунды (мгновенная)                                 |
| **Пропускная способность** | Миллионы строк/сек при чтении                          | Тысячи транзакций/сек                                     |
| **Компрессия**             | 10-100x (благодаря колоночности)                       | 2-3x                                                      |

**Когда выбирать ClickHouse:**

-   Аналитика и отчеты (веб-аналитика, бизнес-метрики)
-   Логирование и мониторинг (логи приложений, метрики серверов)
-   Time-series данные (IoT, финансовые данные)
-   Data warehousing
-   Данные пишутся большими батчами и редко обновляются

**Когда выбирать PostgreSQL:**

-   Операционные данные (пользователи, заказы, продукты)
-   Частые UPDATE/DELETE операции
-   Необходимы транзакции и строгая консистентность
-   Сложные связи между сущностями (foreign keys, constraints)
-   Нужны точечные чтения по первичному ключу

**Практический пример:**
В e-commerce проекте:

-   PostgreSQL — для каталога товаров, корзины, заказов (операционная БД)
-   ClickHouse — для аналитики продаж, отчетов по выручке, анализа поведения пользователей

**Ключевой инсайт:** ClickHouse не заменяет PostgreSQL. Это комплементарные системы. В реальной архитектуре они часто работают вместе: PostgreSQL как source of truth для операционных данных, ClickHouse как аналитическое хранилище, куда данные реплицируются через CDC (Change Data Capture) или ETL.

**Ключевые слова для запоминания:**
OLAP, OLTP, колоночное хранение, агрегации, мутации, батчинг, компрессия

---

### Вопрос 1.2: Почему колоночное хранение делает ClickHouse быстрым для аналитических запросов? Объясните на примере.

**Контекст/Цель вопроса:**
Проверка глубины понимания архитектуры колоночных БД и способности объяснять сложные концепции простым языком.

**Эталонный ответ:**

Колоночное хранение — это способ физической организации данных на диске, где значения одного столбца хранятся последовательно, а не целые строки.

**Визуализация разницы:**

Строковое хранение (PostgreSQL):

```
Disk: [id:1, name:"Alice", age:25, country:"US"] [id:2, name:"Bob", age:30, country:"UK"] ...
```

Колоночное хранение (ClickHouse):

```
Disk:
  id:       [1, 2, 3, 4, ...]
  name:     ["Alice", "Bob", "Charlie", ...]
  age:      [25, 30, 35, ...]
  country:  ["US", "UK", "US", ...]
```

**Три ключевых преимущества:**

1. **Читаем только нужные колонки**

    - Запрос: `SELECT AVG(age) FROM users WHERE country = 'US'`
    - ClickHouse читает только колонки `age` и `country`
    - PostgreSQL читает все поля строки (id, name, age, country, и другие)
    - При широких таблицах (50+ колонок) разница может быть 50-100x

2. **Лучшая компрессия**

    - Колонка `country` с миллионом записей содержит всего ~200 уникальных значений
    - Повторяющиеся данные ("US", "US", "US"...) сжимаются в 50-100 раз
    - Строковое хранение не может так эффективно сжимать, т.к. соседние строки разнородны

3. **Векторизация и SIMD**
    - Процессор обрабатывает колонку `age: [25, 30, 35, 40...]` одной SIMD-инструкцией
    - Можно суммировать 8-16 чисел за одну операцию
    - Строковое хранение требует деструктуризации каждой строки

**Конкретный пример:**

```sql
-- Таблица: 1 млрд строк, 50 колонок
SELECT COUNT(*), AVG(price)
FROM events
WHERE event_type = 'purchase' AND date >= '2024-01-01'
```

-   **ClickHouse**: Читает 3 колонки (event_type, date, price) → ~3 ГБ с диска → 1-2 секунды
-   **PostgreSQL**: Читает все 50 колонок → ~50 ГБ с диска → минуты или OOM

**Компромисс:**
Колоночное хранение плохо для `SELECT * WHERE id = 123` — нужно собирать строку из разных файлов. Поэтому ClickHouse не подходит для OLTP.

**Ключевые слова для запоминания:**
Колоночное хранение, компрессия, векторизация, SIMD, I/O эффективность

---

### Вопрос 1.3: Можно ли использовать ClickHouse как primary database для веб-приложения? Почему да или нет?

**Контекст/Цель вопроса:**
Проверка понимания ограничений ClickHouse и зрелости архитектурного мышления.

**Эталонный ответ:**

**Короткий ответ: Технически можно, но практически — плохая идея.**

**Почему нельзя (или очень сложно):**

1. **Нет полноценных UPDATE/DELETE**

    ```sql
    -- В PostgreSQL:
    UPDATE users SET email = 'new@example.com' WHERE id = 123; -- мгновенно

    -- В ClickHouse:
    ALTER TABLE users UPDATE email = 'new@example.com' WHERE id = 123;
    -- Это мутация: перезаписывает целый data part, может занять секунды/минуты
    ```

    Типичное веб-приложение постоянно обновляет данные (статус заказа, лайки, комментарии) — ClickHouse для этого не создан.

2. **Нет транзакций**

    ```javascript
    // Типичная операция в веб-приложении:
    BEGIN TRANSACTION;
      INSERT INTO orders (user_id, total) VALUES (1, 100);
      UPDATE users SET balance = balance - 100 WHERE id = 1;
    COMMIT;
    ```

    ClickHouse не может атомарно выполнить такие операции. Если INSERT пройдет, а UPDATE упадет — данные станут несогласованными.

3. **Eventual consistency при вставке**

    ```javascript
    await clickhouse.insert("users", [{ id: 1, name: "Alice" }]);
    const user = await clickhouse.query("SELECT * FROM users WHERE id = 1");
    // user может быть пустым! Данные еще не слились в финальный part
    ```

4. **Нет constraints и foreign keys**
   Нельзя гарантировать ссылочную целостность на уровне БД.

5. **Высокая латентность точечных запросов**
   `SELECT * FROM users WHERE id = 123` — не оптимальный сценарий для ClickHouse.

**Когда можно (граничные случаи):**

-   Append-only приложения (форум с комментариями, которые никогда не редактируются)
-   Все операции — это вставка и чтение (логирование, метрики)
-   Нет требований к строгой консистентности

**Правильная архитектура:**

```
User Request → Node.js → PostgreSQL (операционные данные)
                       ↓
                   CDC/ETL Pipeline
                       ↓
                   ClickHouse (аналитика, отчеты)
```

**Реальный кейс:**
Я видел проект, где пытались использовать ClickHouse как основную БД для SaaS-приложения. Через месяц отказались из-за:

-   Невозможности быстро обновлять статус подписки пользователя
-   Проблем с дедупликацией при повторных вставках
-   Нестабильного времени ответа для UI-запросов

**Ключевые слова для запоминания:**
ACID, мутации, eventual consistency, append-only, foreign keys, точечные запросы

---

## 2. Модель данных и движки таблиц

### Вопрос 2.1: Объясните разницу между PRIMARY KEY и ORDER BY в ClickHouse. Почему это не одно и то же?

**Контекст/Цель вопроса:**
Критически важная концепция, которую часто понимают неправильно. Проверяет знание внутренней структуры данных.

**Эталонный ответ:**

В ClickHouse PRIMARY KEY и ORDER BY — это **разные вещи**, хотя они связаны. Это фундаментально отличается от PostgreSQL/MySQL, где PRIMARY KEY автоматически создает индекс.

**ORDER BY (ключ сортировки):**

-   Определяет **физический порядок данных на диске**
-   Данные в каждом data part отсортированы по этим колонкам
-   Обязательный параметр для MergeTree-семейства
-   Напрямую влияет на производительность фильтрации

**PRIMARY KEY (первичный ключ):**

-   Определяет **разреженный индекс** (sparse index)
-   По умолчанию равен ORDER BY, если не указан явно
-   Может быть **префиксом** ORDER BY
-   Используется для быстрого пропуска неподходящих data parts

**Ключевое различие:**

```sql
CREATE TABLE events (
    timestamp DateTime,
    user_id UInt64,
    event_type String,
    page_url String
)
ENGINE = MergeTree()
ORDER BY (timestamp, user_id, event_type)
PRIMARY KEY (timestamp, user_id);
```

**Что происходит:**

1. Данные на диске отсортированы по `(timestamp, user_id, event_type)`
2. Разреженный индекс построен только по `(timestamp, user_id)`
3. Индекс хранит значение первичного ключа каждые 8192 строки (по умолчанию)

**Визуализация разреженного индекса:**

```
Индекс (PRIMARY KEY):
Row 0:     (2024-01-01 00:00:00, 1001)  → granule 0
Row 8192:  (2024-01-01 01:30:00, 3500)  → granule 1
Row 16384: (2024-01-01 03:15:00, 7200)  → granule 2
...

Данные (ORDER BY):
granule 0: [(2024-01-01 00:00:00, 1001, 'click'), (2024-01-01 00:00:01, 1001, 'view'), ...]
granule 1: [(2024-01-01 01:30:00, 3500, 'purchase'), ...]
```

**Когда PRIMARY KEY != ORDER BY полезен:**

```sql
-- Сценарий: логи с высокой кардинальностью request_id
ORDER BY (timestamp, user_id, request_id)  -- сортируем по всем полям
PRIMARY KEY (timestamp, user_id)           -- индексируем только первые два
```

**Зачем:** `request_id` имеет уникальные значения → разреженный индекс по нему бесполезен (каждая granule будет проверяться). Экономим память индекса без потери производительности.

**Последствия неправильного выбора:**

```sql
-- ❌ ПЛОХО: ORDER BY не соответствует запросам
ORDER BY (event_type, timestamp)
-- Запрос: WHERE timestamp > '2024-01-01' AND user_id = 123
-- Проблема: все data parts будут сканироваться, т.к. timestamp не первый
```

```sql
-- ✅ ХОРОШО: ORDER BY соответствует фильтрам
ORDER BY (timestamp, user_id, event_type)
-- Запрос: WHERE timestamp > '2024-01-01' AND user_id = 123
-- ClickHouse пропустит неподходящие data parts сразу
```

**Практическое правило:**
Самый селективный и часто используемый фильтр должен быть **первым** в ORDER BY.

**Ключевые слова для запоминания:**
Разреженный индекс, ORDER BY, PRIMARY KEY, granule, физическая сортировка, префикс

---

### Вопрос 2.2: Что такое партиционирование (PARTITION BY) в ClickHouse и когда его использовать? Какие ошибки допускают при партиционировании?

**Контекст/Цель вопроса:**
Проверка понимания управления данными и знания типичных антипаттернов.

**Эталонный ответ:**

PARTITION BY — это способ физического разделения данных на независимые части (партиции) для эффективного управления жизненным циклом данных.

**Что это дает:**

```sql
CREATE TABLE logs (
    date Date,
    level String,
    message String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)  -- партиция по месяцам
ORDER BY (date, level);
```

**Физическая структура на диске:**

```
/data/logs/
  202401/  (январь 2024)
    ├── all_1_1_0/  (data part)
    └── all_2_2_0/
  202402/  (февраль 2024)
    ├── all_1_1_0/
    └── all_2_2_0/
```

**Ключевые преимущества:**

1. **Эффективное удаление старых данных**

    ```sql
    -- Удаление целой партиции — моментально (просто rm -rf)
    ALTER TABLE logs DROP PARTITION '202401';

    -- Vs. DELETE (медленная мутация):
    ALTER TABLE logs DELETE WHERE date < '2024-02-01';  -- может занять часы
    ```

2. **Оптимизация запросов**

    ```sql
    SELECT * FROM logs WHERE date >= '2024-02-01' AND date < '2024-03-01';
    -- ClickHouse читает только партицию 202402, игнорируя остальные
    ```

3. **Параллельные операции**
    - Слияние parts происходит внутри каждой партиции независимо
    - Можно бэкапить/восстанавливать отдельные партиции

**Типичные ошибки:**

**❌ Ошибка 1: Слишком много мелких партиций**

```sql
-- ПЛОХО: партиция по часам
PARTITION BY toYYYYMMDDhh(timestamp)
-- При 1 млн событий/час → 24 партиции/день → 720 партиций/месяц
-- Проблема: "too many parts", медленные слияния, высокое потребление памяти
```

**Почему плохо:**

-   ClickHouse плохо работает с >1000 активными parts
-   Каждая партиция создает отдельные parts
-   Метаданные всех parts хранятся в памяти

**✅ Правильно:**

```sql
-- Партиция по дням или неделям для высоконагруженных таблиц
PARTITION BY toYYYYMMDD(date)      -- для ~1-10 млн записей/день

-- Партиция по месяцам для средней нагрузки
PARTITION BY toYYYYMM(date)        -- для ~100k-1млн записей/день

-- Партиция по годам или вообще без партиций для маленьких таблиц
PARTITION BY toYear(date)          -- для <100k записей/день
```

**❌ Ошибка 2: Партиционирование по высококардинальному полю**

```sql
-- ПЛОХО: партиция по user_id
PARTITION BY user_id  -- у вас 10 млн пользователей
-- Результат: 10 млн партиций → БД упадет
```

**❌ Ошибка 3: Партиционирование там, где оно не нужно**

```sql
-- Таблица справочник стран (200 записей)
PARTITION BY country  -- бессмысленно
```

**Когда НЕ нужно партиционирование:**

-   Маленькие таблицы (<10 млн строк)
-   Нет регулярного удаления старых данных
-   Нет явного временного измерения

**Реальный кейс:**
В проекте с логами партиционировали по часам (`toYYYYMMDDhh`). После месяца работы:

-   720 партиций × ~50 parts в каждой = 36,000 parts
-   Запросы стали медленными (сканирование метаданных)
-   Постоянные ошибки "too many parts"

**Решение:** Переехали на `toYYYYMMDD` + настроили TTL для автоудаления.

**Практическое правило:**

-   10-100 партиций — оптимально
-   100-1000 партиций — приемлемо
-   > 1000 партиций — проблемы

**Ключевые слова для запоминания:**
PARTITION BY, DROP PARTITION, too many parts, кардинальность, TTL, гранулярность партиций

---

### Вопрос 2.3: Объясните движок ReplacingMergeTree. Когда его использовать вместо обычного MergeTree или мутаций?

**Контекст/Цель вопроса:**
Проверка понимания специализированных движков и умения выбирать правильный подход для дедупликации.

**Эталонный ответ:**

ReplacingMergeTree — это движок, который автоматически удаляет дубликаты строк во время фоновых слияний (merges) data parts.

**Синтаксис:**

```sql
CREATE TABLE user_profiles (
    user_id UInt64,
    name String,
    email String,
    updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)  -- колонка версии
ORDER BY user_id;
```

**Как это работает:**

1. **Вставка:**

    ```javascript
    // Вставляем профиль пользователя несколько раз
    await ch.insert("user_profiles", [
        {
            user_id: 123,
            name: "Alice",
            email: "alice@old.com",
            updated_at: "2024-01-01 10:00:00",
        },
    ]);

    // Позже обновляем email
    await ch.insert("user_profiles", [
        {
            user_id: 123,
            name: "Alice",
            email: "alice@new.com",
            updated_at: "2024-01-02 15:00:00",
        },
    ]);
    ```

2. **Чтение сразу после вставки:**

    ```sql
    SELECT * FROM user_profiles WHERE user_id = 123;
    -- Вернет 2 строки! Дедупликация еще не произошла
    ```

3. **После фонового слияния (через минуты/часы):**
    ```sql
    SELECT * FROM user_profiles WHERE user_id = 123;
    -- Вернет 1 строку с updated_at = '2024-01-02 15:00:00'
    -- Старая версия удалена
    ```

**Критически важные нюансы:**

**⚠️ Нюанс 1: Дедупликация НЕ гарантирована мгновенно**

```sql
-- Дубликаты удаляются только:
-- 1. Во время слияния parts (background merges)
-- 2. Внутри одного data part (если дубликаты попали в один batch)

-- Чтобы форсировать дедупликацию:
OPTIMIZE TABLE user_profiles FINAL;  -- принудительное слияние (дорогая операция!)
```

**⚠️ Нюанс 2: Дедупликация работает только по ORDER BY**

```sql
-- Дедупликация по user_id (это ORDER BY)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY user_id;

-- Если нужна дедупликация по (user_id, device_id):
ORDER BY (user_id, device_id);  -- оба поля должны быть в ORDER BY!
```

**⚠️ Нюанс 3: В SELECT всегда используйте FINAL (или GROUP BY)**

```sql
-- ❌ ПЛОХО: можете получить дубликаты
SELECT * FROM user_profiles WHERE user_id = 123;

-- ✅ ХОРОШО: гарантированная дедупликация (но медленно)
SELECT * FROM user_profiles FINAL WHERE user_id = 123;

-- ✅ ОПТИМАЛЬНО: дедупликация через GROUP BY
SELECT
    user_id,
    argMax(name, updated_at) as name,
    argMax(email, updated_at) as email
FROM user_profiles
WHERE user_id = 123
GROUP BY user_id;
```

**Когда использовать ReplacingMergeTree:**

**✅ Хорошие сценарии:**

1. **CDC (Change Data Capture) из другой БД**

    ```javascript
    // Получаем изменения из PostgreSQL и пишем в ClickHouse
    postgresStream.on("change", async (change) => {
        await clickhouse.insert("user_profiles", [
            {
                user_id: change.user_id,
                ...change.newValues,
                updated_at: change.timestamp,
            },
        ]);
    });
    ```

2. **Idempotent retry при сбоях**

    ```javascript
    // Если вставка упала, можно безопасно повторить
    async function insertEvent(event) {
        try {
            await clickhouse.insert("events", [
                {
                    event_id: event.id, // уникальный ID
                    ...event,
                },
            ]);
        } catch (err) {
            await insertEvent(event); // retry — дубликаты удалятся
        }
    }
    ```

3. **Slowly Changing Dimensions (SCD Type 1)**
   Хранение последней версии справочника.

**❌ Плохие сценарии:**

1. **Высокочастотные обновления одной записи**

    ```javascript
    // Обновление счетчика каждую секунду
    for (let i = 0; i < 1000; i++) {
        await ch.insert("counters", [
            {
                key: "page_views",
                value: i,
            },
        ]);
    }
    // Проблема: 1000 дубликатов, слияние не успевает
    ```

    **Решение:** Используйте SummingMergeTree или AggregatingMergeTree.

2. **Необходимость мгновенной дедупликации**
   Если нужно сразу видеть уникальные данные — ReplacingMergeTree не подходит.

3. **Когда нужна история изменений**
   ReplacingMergeTree удаляет старые версии — используйте обычный MergeTree с версионированием.

**ReplacingMergeTree vs. мутации (UPDATE/DELETE):**

| Аспект             | ReplacingMergeTree       | Мутации (ALTER TABLE UPDATE) |
| ------------------ | ------------------------ | ---------------------------- |
| Производительность | Быстро (INSERT)          | Медленно (перезапись parts)  |
| Гарантия           | Eventual consistency     | Сразу после выполнения       |
| Сложность кода     | Нужен FINAL или GROUP BY | Простой UPDATE               |
| Use case           | Частые "обновления"      | Редкие исправления           |

**Практический пример:**

```javascript
// Node.js: Чтение с дедупликацией
async function getUserProfile(userId) {
    const result = await clickhouse.query(`
    SELECT 
      user_id,
      argMax(name, updated_at) as name,
      argMax(email, updated_at) as email,
      argMax(status, updated_at) as status
    FROM user_profiles
    WHERE user_id = ${userId}
    GROUP BY user_id
  `);

    return result.rows[0];
}
```

**Ключевые слова для запоминания:**
ReplacingMergeTree, дедупликация, FINAL, argMax, eventual consistency, фоновые слияния, ORDER BY

---

### Вопрос 2.4: Что такое Distributed движок и когда его нужно использовать? Какие подводные камни?

**Контекст/Цель вопроса:**
Проверка понимания распределенных систем и кластерной архитектуры ClickHouse.

**Эталонный ответ:**

Distributed — это не реальная таблица, а **виртуальная прокси-таблица**, которая распределяет запросы по нескольким серверам ClickHouse в кластере.

**Архитектура:**

```
┌─────────────────────────────────────┐
│   Distributed Table (виртуальная)   │
│   events_distributed                │
└────────────┬────────────────────────┘
             │
    ┌────────┼────────┐
    ↓        ↓        ↓
┌────────┐ ┌────────┐ ┌────────┐
│ Shard 1│ │ Shard 2│ │ Shard 3│
│ events │ │ events │ │ events │
│(local) │ │(local) │ │(local) │
└────────┘ └────────┘ └────────┘
```

**Создание Distributed таблицы:**

```sql
-- 1. Создаем локальную таблицу на каждом сервере
CREATE TABLE events_local ON CLUSTER my_cluster (
    timestamp DateTime,
    user_id UInt64,
    event_type String
)
ENGINE = MergeTree()
ORDER BY (timestamp, user_id);

-- 2. Создаем Distributed таблицу (виртуальную)
CREATE TABLE events_distributed ON CLUSTER my_cluster AS events_local
ENGINE = Distributed(
    my_cluster,      -- имя кластера
    default,         -- имя базы данных
    events_local,    -- имя локальной таблицы
    rand()           -- функция шардирования
);
```

**Как это работает:**

**При SELECT:**

```sql
SELECT COUNT(*) FROM events_distributed WHERE timestamp > '2024-01-01';
```

1. Запрос отправляется на все шарды параллельно
2. Каждый шард выполняет запрос на своих локальных данных
3. Результаты агрегируются на сервере-инициаторе

**При INSERT:**

```sql
INSERT INTO events_distributed VALUES (...);
```

1. Данные распределяются по шардам согласно функции шардирования (rand())
2. Каждый кусок данных отправляется на соответствующий шард
3. Шард записывает в локальную таблицу

**Функции шардирования:**

```sql
-- Случайное распределение (равномерно, но нельзя искать по ключу)
ENGINE = Distributed(cluster, db, table, rand());

-- Шардирование по user_id (все события пользователя на одном шарде)
ENGINE = Distributed(cluster, db, table, user_id);

-- Хеш от user_id (более равномерное распределение)
ENGINE = Distributed(cluster, db, table, cityHash64(user_id));
```

**Критические подводные камни:**

**❌ Подводный камень 1: INSERT в Distributed — дорогая операция**

```javascript
// ❌ ПЛОХО: вставка в Distributed
for (let i = 0; i < 10000; i++) {
    await ch.insert("events_distributed", [event]);
}
// Проблема:
// - Каждый INSERT отправляется на координатор
// - Координатор распределяет по шардам
// - Сетевые задержки × 10000
```

**✅ ХОРОШО: вставка напрямую в локальную таблицу нужного шарда**

```javascript
// Вариант 1: Определяем нужный шард в приложении
const shardIndex = hashFunction(event.user_id) % shardCount;
const connection = shardConnections[shardIndex];
await connection.insert('events_local', [event]);

// Вариант 2: Батчи в Distributed (приемлемо)
const batch = [...1000 событий];
await ch.insert('events_distributed', batch);
```

**❌ Подводный камень 2: JOIN в распределенных запросах**

```sql
-- Запрос на Distributed таблице
SELECT
    e.user_id,
    u.name,
    COUNT(*)
FROM events_distributed e
JOIN users_distributed u ON e.user_id = u.user_id
GROUP BY e.user_id, u.name;
```

**Что происходит:**

1. Каждый шард выполняет JOIN локально
2. Но данные users_distributed и events_distributed могут быть на разных шардах!
3. ClickHouse подтягивает **всю** таблицу `users_distributed` на каждый шард
4. Огромный сетевой трафик и потребление памяти

**Решение:**

```sql
-- Использовать GLOBAL JOIN (осторожно!)
SELECT ...
FROM events_distributed e
GLOBAL JOIN users_distributed u ON e.user_id = u.user_id;

-- Или: денормализовать данные (лучше для производительности)
```

**❌ Подводный камень 3: Неравномерное распределение данных**

```sql
-- Шардирование по дате
ENGINE = Distributed(cluster, db, events_local, toYYYYMMDD(timestamp));
-- Проблема: все данные за один день попадают на один шард
-- Один шард перегружен, остальные простаивают
```

**✅ Правильно:**

```sql
-- Комбинированный ключ
ENGINE = Distributed(cluster, db, events_local,
    cityHash64(concat(toString(timestamp), toString(user_id)))
);
```

**Когда использовать Distributed:**

**✅ Нужен Distributed:**

-   Данных больше, чем может хранить один сервер (>10 ТБ)
-   Необходима горизонтальная масштабируемость
-   Высокая пропускная способность записи (>1 млн событий/сек)
-   Параллельная обработка запросов

**❌ НЕ нужен Distributed:**

-   Данные помещаются на одном сервере (<1-2 ТБ)
-   Низкая/средняя нагрузка
-   Сложность операций не оправдана

**Практический паттерн:**

```javascript
// Node.js: Оптимальная вставка в кластер
class ClickHouseCluster {
    constructor(shards) {
        this.shards = shards.map((host) => createClient({ host }));
    }

    async insert(table, rows) {
        // Группируем по шардам
        const buckets = Array(this.shards.length)
            .fill(null)
            .map(() => []);

        for (const row of rows) {
            const shardIdx = this.getShardIndex(row.user_id);
            buckets[shardIdx].push(row);
        }

        // Параллельная вставка в каждый шард
        await Promise.all(
            buckets.map((bucket, idx) =>
                bucket.length > 0
                    ? this.shards[idx].insert(table, bucket)
                    : Promise.resolve()
            )
        );
    }

    getShardIndex(userId) {
        return hash(userId) % this.shards.length;
    }
}
```

**Ключевые слова для запоминания:**
Distributed, шардирование, GLOBAL JOIN, координатор, локальная таблица, функция шардирования

---

## 3. Интеграция с Node.js (практика)

### Вопрос 3.1: Какую клиентскую библиотеку для ClickHouse выбрать в Node.js проекте и почему? Покажите пример эффективной записи потока событий.

**Контекст/Цель вопроса:**
Проверка практического опыта работы с ClickHouse из Node.js и понимания оптимальных паттернов записи.

**Эталонный ответ:**

**Выбор библиотеки:**

На данный момент (2025) есть две основные официальные библиотеки:

1. **@clickhouse/client** (рекомендуется)

    - Официальная библиотека от команды ClickHouse
    - Поддержка TypeScript out of the box
    - Streaming, async iterators
    - HTTP/HTTPS transport
    - Активная разработка

2. **clickhouse-js** (старая, но стабильная)
    - Более простой API
    - Меньше возможностей для streaming
    - Подходит для простых случаев

**Рекомендация: используйте @clickhouse/client**

**Установка и базовая настройка:**

```javascript
import { createClient } from "@clickhouse/client";

const clickhouse = createClient({
    host: "http://localhost:8123",
    username: "default",
    password: "",
    database: "analytics",

    // Критически важные настройки для производительности
    clickhouse_settings: {
        // Асинхронные вставки (буферизация на стороне сервера)
        async_insert: 1,
        wait_for_async_insert: 0, // не ждем подтверждения

        // Размер буфера для асинхронных вставок
        async_insert_max_data_size: 10485760, // 10 MB
        async_insert_busy_timeout_ms: 1000, // флашим каждую секунду
    },

    // Connection pool
    max_open_connections: 10,
    request_timeout: 30000,
});
```

**Паттерн 1: Батчинг в приложении (для полного контроля)**

```javascript
class EventBuffer {
    constructor(clickhouse, options = {}) {
        this.clickhouse = clickhouse;
        this.buffer = [];
        this.maxSize = options.maxSize || 1000; // макс. событий в батче
        this.maxWaitMs = options.maxWaitMs || 5000; // макс. время ожидания
        this.flushTimer = null;

        this.startFlushTimer();
    }

    async push(event) {
        this.buffer.push(event);

        // Флаш по размеру
        if (this.buffer.length >= this.maxSize) {
            await this.flush();
        }
    }

    async flush() {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0, this.buffer.length);

        try {
            await this.clickhouse.insert({
                table: "events",
                values: batch,
                format: "JSONEachRow",
            });

            console.log(`Flushed ${batch.length} events`);
        } catch (err) {
            console.error("Insert failed:", err);
            // Повторная попытка или запись в dead letter queue
            await this.handleFailedBatch(batch, err);
        }

        this.startFlushTimer();
    }

    startFlushTimer() {
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), this.maxWaitMs);
    }

    async handleFailedBatch(batch, error) {
        // Стратегии обработки ошибок:
        // 1. Retry с exponential backoff
        // 2. Запись в Redis/Kafka для повторной обработки
        // 3. Логирование в файл для ручного восстановления
    }

    async close() {
        clearTimeout(this.flushTimer);
        await this.flush();
    }
}

// Использование
const eventBuffer = new EventBuffer(clickhouse, {
    maxSize: 5000,
    maxWaitMs: 3000,
});

// В обработчике HTTP-запроса
app.post("/track", async (req, res) => {
    const event = {
        timestamp: new Date(),
        user_id: req.body.user_id,
        event_type: req.body.event_type,
        properties: JSON.stringify(req.body.properties),
    };

    await eventBuffer.push(event);

    // Отвечаем сразу, не ждем вставки в ClickHouse
    res.json({ status: "ok" });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    await eventBuffer.close();
    await clickhouse.close();
    process.exit(0);
});
```

**Паттерн 2: Использование async_insert (делегирование буферизации серверу)**

```javascript
// Более простой вариант — полагаемся на ClickHouse
async function trackEvent(event) {
    await clickhouse.insert({
        table: "events",
        values: [event],
        format: "JSONEachRow",
        clickhouse_settings: {
            async_insert: 1,
            wait_for_async_insert: 0, // не блокируем ответ
        },
    });
}

// Каждое событие вставляется отдельно,
// но ClickHouse буферизует их внутри
app.post("/track", async (req, res) => {
    await trackEvent({
        timestamp: new Date(),
        user_id: req.body.user_id,
        event_type: req.body.event_type,
    });

    res.json({ status: "ok" });
});
```

**Сравнение подходов:**

| Аспект             | Батчинг в приложении   | async_insert             |
| ------------------ | ---------------------- | ------------------------ |
| Контроль           | Полный                 | Ограниченный             |
| Задержка записи    | Настраиваемая          | ~1 сек (по умолчанию)    |
| Обработка ошибок   | Гибкая                 | Автоматическая           |
| Потребление памяти | В приложении           | На сервере ClickHouse    |
| Сложность кода     | Выше                   | Ниже                     |
| Рекомендация       | High-volume (>10k/сек) | Medium-volume (<10k/сек) |

**Паттерн 3: Streaming для очень больших батчей**

```javascript
import { pipeline } from "stream/promises";
import { Readable } from "stream";

async function bulkInsertFromStream(dataGenerator) {
    const stream = Readable.from(dataGenerator());

    await clickhouse.insert({
        table: "events",
        values: stream,
        format: "JSONEachRow",
    });
}

// Пример: вставка из Kafka
async function* readFromKafka(consumer) {
    for await (const message of consumer) {
        yield JSON.parse(message.value);
    }
}

await bulkInsertFromStream(() => readFromKafka(kafkaConsumer));
```

**Критические best practices:**

1. **Всегда используйте батчи** (минимум 1000-10000 строк)
2. **Не ждите подтверждения** если можете потерять <1% данных (async_insert)
3. **Обрабатывайте ошибки** — ClickHouse может отклонить вставку (квоты, схема)
4. **Мониторьте размер батчей** — слишком большие (>100MB) могут вызвать OOM
5. **Graceful shutdown** — всегда флашите буфер перед выходом

**Ключевые слова для запоминания:**
@clickhouse/client, батчинг, async_insert, JSONEachRow, буферизация, streaming, graceful shutdown

---

### Вопрос 3.2: Как безопасно читать большие объемы данных из ClickHouse в Node.js? Почему OFFSET — это плохо?

**Контекст/Цель вопроса:**
Проверка понимания проблем пагинации больших датасетов и знания эффективных альтернатив.

**Эталонный ответ:**

**Проблема с OFFSET:**

```javascript
// ❌ ПЛОХО: Классическая пагинация через OFFSET
async function getEventsPage(page, pageSize = 1000) {
    const offset = page * pageSize;

    const result = await clickhouse.query({
        query: `
      SELECT * FROM events 
      ORDER BY timestamp DESC 
      LIMIT ${pageSize} OFFSET ${offset}
    `,
        format: "JSONEachRow",
    });

    return result.json();
}

// Проблемы:
// 1. На странице 1000 (offset=1,000,000) ClickHouse:
//    - Читает 1,001,000 строк
//    - Сортирует их
//    - Отбрасывает первые 1,000,000
//    - Возвращает последние 1,000
//
// 2. Производительность деградирует линейно: O(offset + limit)
// 3. При offset=10,000,000 запрос может занять минуты
```

**Почему OFFSET особенно плох в ClickHouse:**

-   Колоночное хранение → нужно читать все колонки для всех строк
-   Распределенные запросы → каждый шард делает OFFSET локально, потом объединение
-   Нет индекса для быстрого skip (как B-tree в PostgreSQL)

**✅ Решение 1: Keyset Pagination (Cursor-based)**

```javascript
// Итерация по первичному ключу
async function* iterateEvents(startTimestamp = null) {
    let lastTimestamp = startTimestamp;
    const batchSize = 10000;

    while (true) {
        const query = lastTimestamp
            ? `SELECT * FROM events 
         WHERE timestamp > '${lastTimestamp}' 
         ORDER BY timestamp ASC 
         LIMIT ${batchSize}`
            : `SELECT * FROM events 
         ORDER BY timestamp ASC 
         LIMIT ${batchSize}`;

        const result = await clickhouse.query({
            query,
            format: "JSONEachRow",
        });

        const rows = await result.json();

        if (rows.length === 0) break;

        for (const row of rows) {
            yield row;
        }

        // Курсор — последний timestamp из batch
        lastTimestamp = rows[rows.length - 1].timestamp;

        // Если получили меньше чем batchSize, достигли конца
        if (rows.length < batchSize) break;
    }
}

// Использование
for await (const event of iterateEvents()) {
    await processEvent(event);
}
```

**Преимущества keyset pagination:**

-   Константная производительность: O(batchSize)
-   Использует ORDER BY индекс
-   Работает на любом объеме данных

**Ограничение:** нужен уникальный, монотонный ключ (timestamp, id).

**✅ Решение 2: Streaming API (для больших результатов)**

```javascript
async function exportEventsToFile(filename) {
    const writeStream = fs.createWriteStream(filename);

    const resultStream = await clickhouse.query({
        query: `
      SELECT * FROM events 
      WHERE date >= '2024-01-01'
      FORMAT JSONEachRow
    `,
        // Streaming response
    });

    await pipeline(resultStream.stream, writeStream);

    console.log(`Exported to ${filename}`);
}

// Обработка построчно без загрузки в память
async function processLargeDataset() {
    const resultStream = await clickhouse.query({
        query: "SELECT * FROM events WHERE date >= today()",
    });

    let count = 0;

    for await (const rows of resultStream.stream) {
        // rows — это batch строк (по умолчанию ~1000)
        for (const row of rows) {
            await processRow(row);
            count++;

            if (count % 100000 === 0) {
                console.log(`Processed ${count} rows`);
            }
        }
    }
}
```

**✅ Решение 3: Пагинация по партициям (для time-series)**

```javascript
async function getEventsByDateRange(startDate, endDate) {
  // ClickHouse эффективно фильтрует по партициям
  const query = `
    SELECT * FROM events
    WHERE date >= '${startDate}' AND date <= '${endDate}'
    ORDER BY timestamp
  `;

  const resultStream = await clickhouse.query({ query });

  // Обрабатываем streaming
  for await (const batch of resultStream.stream) {
    yield batch;
  }
}

// Итерация по дням
async function processByDays() {
  const start = new Date('2024-01-01');
  const end = new Date('2024-12-31');

  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];

    for await (const batch of getEventsByDateRange(dateStr, dateStr)) {
      await processBatch(batch);
    }
  }
}
```

**✅ Решение 4: SAMPLE для аппроксимации (когда точность не критична)**

```javascript
// Вместо чтения всех данных, берем sample
async function getApproximateStats() {
    const result = await clickhouse.query({
        query: `
      SELECT 
        COUNT() * 10 as estimated_total,  -- умножаем на 1/sample_rate
        AVG(price) as avg_price,
        quantile(0.95)(response_time) as p95_response_time
      FROM events
      SAMPLE 0.1  -- читаем только 10% данных
      WHERE date >= today() - INTERVAL 7 DAY
    `,
    });

    return result.json();
}
```

**Практический пример: API с пагинацией**

```javascript
import { createClient } from "@clickhouse/client";

class EventsRepository {
    constructor(clickhouse) {
        this.clickhouse = clickhouse;
    }

    // Cursor-based pagination для API
    async getEvents(cursor = null, limit = 100) {
        const query = cursor
            ? `SELECT * FROM events 
         WHERE (timestamp, event_id) > ('${cursor.timestamp}', ${cursor.event_id})
         ORDER BY timestamp, event_id
         LIMIT ${limit}`
            : `SELECT * FROM events 
         ORDER BY timestamp, event_id
         LIMIT ${limit}`;

        const result = await this.clickhouse.query({
            query,
            format: "JSONEachRow",
        });

        const rows = await result.json();

        // Формируем cursor для следующей страницы
        const nextCursor =
            rows.length === limit
                ? {
                      timestamp: rows[rows.length - 1].timestamp,
                      event_id: rows[rows.length - 1].event_id,
                  }
                : null;

        return {
            data: rows,
            nextCursor,
            hasMore: nextCursor !== null,
        };
    }
}

// API endpoint
app.get("/api/events", async (req, res) => {
    const cursor = req.query.cursor ? JSON.parse(req.query.cursor) : null;

    const result = await eventsRepo.getEvents(cursor, 100);

    res.json({
        events: result.data,
        pagination: {
            cursor: result.nextCursor
                ? JSON.stringify(result.nextCursor)
                : null,
            hasMore: result.hasMore,
        },
    });
});
```

**Сравнение подходов:**

| Подход            | Производительность    | Сложность | Use Case                  |
| ----------------- | --------------------- | --------- | ------------------------- |
| OFFSET            | O(offset + limit) ❌  | Простая   | Маленькие датасеты (<10k) |
| Keyset Pagination | O(limit) ✅           | Средняя   | API pagination            |
| Streaming         | O(total) ✅           | Средняя   | Экспорт, ETL              |
| По партициям      | O(partition) ✅       | Простая   | Time-series               |
| SAMPLE            | O(sample \* total) ✅ | Простая   | Аппроксимация             |

**Ключевые слова для запоминания:**
Keyset pagination, cursor-based, streaming, OFFSET проблемы, партиции, SAMPLE

---

### Вопрос 3.3: Как решить проблему сериализации больших чисел (UInt64, Int128) при работе с ClickHouse через JSON?

**Контекст/Цель вопроса:**
Проверка знания нюансов работы с типами данных ClickHouse и понимания ограничений JavaScript/JSON.

**Эталонный ответ:**

**Проблема:**

JavaScript/JSON поддерживает числа только до `Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9,007,199,254,740,991`.

ClickHouse использует типы:

-   `UInt64` — до 18,446,744,073,709,551,615
-   `Int64` — от -9,223,372,036,854,775,808
-   `Int128`, `UInt128` и т.д.

**Что происходит при потере точности:**

```javascript
// ClickHouse возвращает user_id: 9223372036854775807 (Int64)
const result = await clickhouse.query({
    query: "SELECT user_id FROM users WHERE user_id = 9223372036854775807",
    format: "JSONEachRow",
});

const data = await result.json();
console.log(data[0].user_id);
// Вывод: 9223372036854776000 ❌ (потеряна точность!)

// Проблема: JSON.parse() преобразует в Number, который не может хранить это значение
```

**✅ Решение 1: Использовать формат JSONEachRow с output_format_json_quote_64bit_integers**

```javascript
const result = await clickhouse.query({
    query: "SELECT user_id, session_id FROM events",
    format: "JSONEachRow",
    clickhouse_settings: {
        // ClickHouse вернет большие числа как строки
        output_format_json_quote_64bit_integers: 1,
    },
});

const data = await result.json();
console.log(data[0].user_id); // "9223372036854775807" ✅ (строка)

// Теперь можно безопасно работать
const userId = BigInt(data[0].user_id); // конвертируем в BigInt
```

**✅ Решение 2: Использовать формат JSONStrings (все значения как строки)**

```javascript
const result = await clickhouse.query({
    query: "SELECT user_id, timestamp, price FROM events",
    format: "JSONStringsEachRow", // все поля — строки
});

const data = await result.json();
console.log(data[0]);
// {
//   user_id: "9223372036854775807",
//   timestamp: "2024-01-01 12:00:00",
//   price: "99.95"
// }

// Парсим нужные типы вручную
const parsed = {
    user_id: BigInt(data[0].user_id),
    timestamp: new Date(data[0].timestamp),
    price: parseFloat(data[0].price),
};
```

**✅ Решение 3: Кастовать большие числа к String на стороне ClickHouse**

```javascript
const result = await clickhouse.query({
    query: `
    SELECT 
      toString(user_id) as user_id,  -- явное преобразование
      event_type,
      timestamp
    FROM events
  `,
    format: "JSONEachRow",
});

const data = await result.json();
console.log(data[0].user_id); // "9223372036854775807" ✅
```

**✅ Решение 4: Использовать TypeScript типы для безопасности**

```typescript
import { createClient } from "@clickhouse/client";

interface Event {
    user_id: string; // храним как string
    event_type: string;
    timestamp: string;
    session_id: string; // тоже bigint → string
}

const clickhouse = createClient({
    host: "http://localhost:8123",
    clickhouse_settings: {
        output_format_json_quote_64bit_integers: 1,
    },
});

async function getEvents(): Promise<Event[]> {
    const result = await clickhouse.query({
        query: "SELECT user_id, event_type, timestamp, session_id FROM events",
        format: "JSONEachRow",
    });

    return result.json<Event[]>();
}

// Использование
const events = await getEvents();
events.forEach((event) => {
    const userId = BigInt(event.user_id); // безопасная конвертация
    console.log(`User ${userId} did ${event.event_type}`);
});
```

**Практический паттерн: Helper для работы с BigInt**

```javascript
class ClickHouseSerializer {
    // Преобразование ClickHouse → JS
    static deserialize(row, schema) {
        const result = {};

        for (const [key, type] of Object.entries(schema)) {
            switch (type) {
                case "bigint":
                    result[key] = BigInt(row[key]);
                    break;
                case "date":
                    result[key] = new Date(row[key]);
                    break;
                case "json":
                    result[key] = JSON.parse(row[key]);
                    break;
                default:
                    result[key] = row[key];
            }
        }

        return result;
    }

    // Преобразование JS → ClickHouse
    static serialize(obj, schema) {
        const result = {};

        for (const [key, type] of Object.entries(schema)) {
            switch (type) {
                case "bigint":
                    result[key] = obj[key].toString(); // BigInt → String
                    break;
                case "date":
                    result[key] = obj[key].toISOString();
                    break;
                case "json":
                    result[key] = JSON.stringify(obj[key]);
                    break;
                default:
                    result[key] = obj[key];
            }
        }

        return result;
    }
}

// Использование
const schema = {
    user_id: "bigint",
    timestamp: "date",
    properties: "json",
    event_type: "string",
};

// Чтение
const result = await clickhouse.query({
    query: "SELECT * FROM events",
    clickhouse_settings: { output_format_json_quote_64bit_integers: 1 },
});
const rawRows = await result.json();
const events = rawRows.map((row) =>
    ClickHouseSerializer.deserialize(row, schema)
);

// Запись
const newEvent = {
    user_id: 9223372036854775807n, // BigInt literal
    timestamp: new Date(),
    properties: { page: "/home", referrer: "google" },
    event_type: "pageview",
};

await clickhouse.insert({
    table: "events",
    values: [ClickHouseSerializer.serialize(newEvent, schema)],
    format: "JSONEachRow",
});
```

**Альтернатива: Использовать UUID вместо UInt64**

```sql
-- Вместо UInt64 для ID
CREATE TABLE users (
    user_id UUID,  -- нативно поддерживается в JSON
    name String
) ENGINE = MergeTree() ORDER BY user_id;
```

```javascript
// UUID сериализуется корректно
const result = await clickhouse.query({
    query: "SELECT user_id FROM users",
    format: "JSONEachRow",
});

const data = await result.json();
console.log(data[0].user_id);
// "550e8400-e29b-41d4-a716-446655440000" ✅
```

**Сравнение решений:**

| Подход                                  | Плюсы              | Минусы                       |
| --------------------------------------- | ------------------ | ---------------------------- |
| output_format_json_quote_64bit_integers | Автоматически      | Нужно помнить настройку      |
| JSONStringsEachRow                      | Все типы безопасны | Больше парсинга              |
| toString() в SQL                        | Явный контроль     | Больше кода в запросах       |
| UUID вместо UInt64                      | Нет проблем с JSON | Больше размер (16 vs 8 байт) |

**Ключевые слова для запоминания:**
UInt64, BigInt, Number.MAX_SAFE_INTEGER, output_format_json_quote_64bit_integers, JSONStringsEachRow, сериализация

---

## 4. Оптимизация запросов (глубина понимания)

### Вопрос 4.1: Запрос выполняется медленно. Опишите пошаговый алгоритм диагностики и оптимизации.

**Контекст/Цель вопроса:**
Проверка системного подхода к решению проблем производительности и знания инструментов диагностики.

**Эталонный ответ:**

**Алгоритм диагностики (5 шагов):**

**Шаг 1: Получить EXPLAIN запроса**

```sql
EXPLAIN indexes = 1, actions = 1
SELECT
    user_id,
    COUNT() as event_count
FROM events
WHERE date >= '2024-01-01'
  AND event_type = 'purchase'
GROUP BY user_id;
```

**Что смотреть в EXPLAIN:**

-   **ReadFromMergeTree** — какие parts читаются
-   **indexes** — используются ли индексы (primary key, skip indexes)
-   **Prewhere** — есть ли prewhere оптимизация (фильтрация до чтения всех колонок)

```
ReadFromMergeTree
 ├─ Prewhere: event_type = 'purchase'  ✅ (фильтрация до чтения user_id)
 ├─ Parts: 45 / 120  ✅ (читаем только 45 parts из 120)
 └─ Granules: 8523 / 24000  ✅ (пропустили много granules)
```

**Если нет Prewhere или читаются все parts → проблема.**

**Шаг 2: Анализ через system.query_log**

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage,
    query
FROM system.query_log
WHERE
    type = 'QueryFinish'
    AND query LIKE '%FROM events%'
    AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC
LIMIT 10;
```

**Ключевые метрики:**

| Метрика                     | Что означает     | Хорошо              | Плохо             |
| --------------------------- | ---------------- | ------------------- | ----------------- |
| **read_rows / result_rows** | Селективность    | < 10x               | > 1000x           |
| **query_duration_ms**       | Время выполнения | < 100ms             | > 10s             |
| **memory_usage**            | Потребление RAM  | < 1GB               | > 10GB            |
| **read_bytes / read_rows**  | Размер строки    | Соответствует схеме | Аномально большой |

**Пример анализа:**

```
query_duration_ms: 15000  ❌
read_rows: 100,000,000    ❌ (100 млн строк)
result_rows: 1,000        ✅
read_rows/result_rows: 100,000x  ❌❌❌ (ужасная селективность!)
```

**Диагноз:** Запрос читает 100M строк чтобы вернуть 1000 → плохая фильтрация или отсутствие индексов.

**Шаг 3: Проверить ORDER BY таблицы**

```sql
SELECT
    engine,
    sorting_key,
    primary_key,
    partition_key
FROM system.tables
WHERE name = 'events' AND database = 'default';
```

**Сопоставить с WHERE-условиями запроса:**

```sql
-- Таблица:
ORDER BY (date, user_id, event_type)

-- Запрос 1: ✅ эффективный
WHERE date >= '2024-01-01' AND user_id = 123

-- Запрос 2: ❌ неэффективный
WHERE event_type = 'purchase' AND user_id = 123
-- Проблема: date не в WHERE, но первый в ORDER BY
-- ClickHouse не может пропустить parts
```

**Правило:** Фильтры в WHERE должны соответствовать префиксу ORDER BY.

**Шаг 4: Профилирование с query_log и trace_log**

```sql
-- Включить детальное логирование
SET send_logs_level = 'trace';
SET log_queries = 1;
SET log_query_threads = 1;

-- Выполнить проблемный запрос
SELECT ... FROM events WHERE ...;

-- Проанализировать
SELECT
    event_time,
    query_duration_ms,
    ProfileEvents.Names,
    ProfileEvents.Values
FROM system.query_log
ARRAY JOIN
    ProfileEvents.Names,
    ProfileEvents.Values
WHERE query_id = 'your-query-id'
ORDER BY ProfileEvents.Values DESC;
```

**Ключевые ProfileEvents:**

-   `SelectedParts` — сколько parts было выбрано
-   `SelectedMarks` — сколько granules прочитано
-   `RealTimeMicroseconds` — реальное время
-   `UserTimeMicroseconds` — CPU time

**Шаг 5: Проверить нагрузку на систему**

```sql
-- Конкурирующие запросы
SELECT
    COUNT() as concurrent_queries,
    SUM(read_rows) as total_read_rows
FROM system.processes
WHERE query NOT LIKE '%system.processes%';

-- Использование ресурсов
SELECT
    metric,
    value
FROM system.metrics
WHERE metric IN (
    'MemoryTracking',
    'Query',
    'BackgroundPoolTask'
);
```

**Типичные проблемы и решения:**

**Проблема 1: Читаем слишком много строк**

```sql
-- ❌ ПЛОХО: фильтр по некл primary key
SELECT * FROM events WHERE event_type = 'click';
-- read_rows: 1,000,000,000 для возврата 10,000 строк

-- ✅ РЕШЕНИЕ 1: Добавить фильтр по primary key
SELECT * FROM events
WHERE date >= '2024-01-01'  -- первый в ORDER BY!
  AND event_type = 'click';
-- read_rows: 50,000,000 (пропустили старые parts)

-- ✅ РЕШЕНИЕ 2: Создать skip index
CREATE INDEX idx_event_type ON events (event_type) TYPE bloom_filter GRANULARITY 4;
```

**Проблема 2: Неэффективный ORDER BY в запросе**

```sql
-- ❌ ПЛОХО: сортировка миллионов строк
SELECT * FROM events
WHERE date >= '2024-01-01'
ORDER BY event_time DESC  -- event_time не в sorting key таблицы!
LIMIT 100;

-- ✅ РЕШЕНИЕ: ORDER BY должен совпадать с sorting key таблицы
-- Или создать materialized view с нужной сортировкой
```

**Проблема 3: Большие GROUP BY**

```sql
-- ❌ ПЛОХО: группировка по высококардинальному полю
SELECT user_id, COUNT(*)
FROM events
GROUP BY user_id;  -- 10 млн уникальных user_id → OOM

-- ✅ РЕШЕНИЕ: Добавить LIMIT или фильтр
SELECT user_id, COUNT(*) as cnt
FROM events
WHERE date >= today()
GROUP BY user_id
ORDER BY cnt DESC
LIMIT 1000;
```

**Практический чеклист оптимизации:**

```
□ WHERE фильтры соответствуют префиксу ORDER BY?
□ Используется PREWHERE для селективных фильтров?
□ read_rows / result_rows < 100x?
□ Есть ли ненужные колонки в SELECT?
□ Можно ли добавить skip index?
□ Можно ли использовать SAMPLE для аппроксимации?
□ Нужна ли материализованная вью с предагрегацией?
□ Правильно ли выбраны партиции (не слишком много/мало)?
```

**Ключевые слова для запоминания:**
EXPLAIN, query_log, ProfileEvents, read_rows, селективность, PREWHERE, sorting key, skip index

---

### Вопрос 4.2: Что такое скип-индексы (skip indexes) в ClickHouse? Когда они эффективны, а когда бесполезны?

**Контекст/Цель вопроса:**
Проверка глубокого понимания вторичных индексов и умения принимать обоснованные решения об их использовании.

**Эталонный ответ:**

Skip index (data skipping index) — это вспомогательная структура данных, которая позволяет ClickHouse пропускать целые granules (блоки строк) без их чтения, если гарантированно известно, что они не содержат нужных данных.

**Важное отличие от B-tree индексов (PostgreSQL/MySQL):**

-   Skip index НЕ указывает где находится конкретная строка
-   Skip index только говорит "эту granule можно пропустить"
-   Это дополнение к primary key, не замена

**Типы skip indexes:**

**1. minmax — минимум и максимум в granule**

```sql
CREATE TABLE events (
    timestamp DateTime,
    price Decimal(10,2),
    category String
)
ENGINE = MergeTree()
ORDER BY timestamp;

-- Индекс: для каждой granule храним min и max price
CREATE INDEX idx_price ON events (price) TYPE minmax GRANULARITY 4;
```

**Как работает:**

```
Granule 0: min_price=10, max_price=50
Granule 1: min_price=45, max_price=120
Granule 2: min_price=100, max_price=200

SELECT * FROM events WHERE price = 150;
→ Skip granule 0 (max=50 < 150) ✅
→ Read granule 1 (45 ≤ 150 ≤ 120? нет, но может пересекаться)
→ Read granule 2 (100 ≤ 150 ≤ 200) ✅
```

**✅ Эффективен для:**

-   Диапазонные запросы (`price BETWEEN 100 AND 200`)
-   Числовые колонки с низкой кардинальностью в granule
-   Даты/времена (если не в primary key)

**❌ Бесполезен для:**

-   Колонки с высокой вариативностью внутри granule
-   Точечные поиски строк (`id = 12345`)
-   String колонки (только числа и даты)

---

**2. bloom_filter — вероятностная проверка наличия**

```sql
CREATE INDEX idx_user_id ON events (user_id) TYPE bloom_filter GRANULARITY 4;
```

**Как работает:**
Bloom filter — это компактная структура, которая может ответить:

-   "Определенно НЕТ в granule" → skip granule
-   "Возможно ЕСТЬ в granule" → read granule

```
SELECT * FROM events WHERE user_id = 12345;

Granule 0: bloom_filter.check(12345) → false → SKIP ✅
Granule 1: bloom_filter.check(12345) → true → READ (может быть false positive)
```

**✅ Эффективен для:**

-   Поиск по уникальным ID (`user_id = 123`, `session_id = 'abc'`)
-   String поля с точными совпадениями (`email = 'user@example.com'`)
-   IN операторы (`user_id IN (1, 2, 3)`)

**❌ Бесполезен для:**

-   LIKE запросы (`email LIKE '%@gmail.com'`)
-   Диапазонные запросы (`price > 100`)
-   Колонки с низкой кардинальностью (`status IN ('active', 'inactive')`) — primary key лучше

**Настройка bloom_filter:**

```sql
-- Параметр: false positive rate (0.01 = 1% ложных срабатываний)
CREATE INDEX idx_email ON users (email)
TYPE bloom_filter(0.01)
GRANULARITY 4;

-- Меньше false positive → больше размер индекса
-- 0.001 (0.1%) — точнее, но больше памяти
-- 0.05 (5%) — компактнее, но больше лишних чтений
```

---

**3. set — список уникальных значений в granule**

```sql
CREATE INDEX idx_category ON events (category) TYPE set(100) GRANULARITY 4;
```

**Как работает:**
Для каждой granule хранится Set уникальных значений (макс. 100 элементов).

```
Granule 0: category ∈ {'electronics', 'books'}
Granule 1: category ∈ {'clothing', 'food', 'toys'}

SELECT * FROM events WHERE category = 'electronics';
→ Read granule 0 (есть 'electronics') ✅
→ Skip granule 1 (нет 'electronics') ✅
```

**✅ Эффективен для:**

-   Низкокардинальные String поля (`category`, `status`, `country`)
-   Точные совпадения и IN операторы
-   Когда уникальных значений в granule < limit (100)

**❌ Бесполезен для:**

-   Высококардинальные поля (user_id, email) — Set переполнится
-   Если > limit значений, индекс отключается для granule

---

**4. ngrambf_v1 — для LIKE запросов**

```sql
CREATE INDEX idx_message ON logs (message)
TYPE ngrambf_v1(4, 4096, 3, 0)
GRANULARITY 1;
```

**Параметры:** (n-gram size, bloom filter size, hash functions, seed)

**✅ Эффективен для:**

-   LIKE с подстроками (`message LIKE '%error%'`)
-   Полнотекстовый поиск по ключевым словам

**❌ Очень дорогой:**

-   Большой размер индекса
-   Медленное построение
-   Используйте только если действительно нужен LIKE

---

**Когда skip indexes БЕСПОЛЕЗНЫ:**

**1. Колонка уже в PRIMARY KEY**

```sql
-- ❌ БЕССМЫСЛЕННО
CREATE TABLE events (date Date, user_id UInt64)
ENGINE = MergeTree()
ORDER BY (date, user_id);

CREATE INDEX idx_date ON events (date) TYPE minmax;  -- не нужен!
-- date уже в primary key, пропуск granules работает автоматически
```

**2. Высокая кардинальность в каждой granule**

```sql
-- ❌ БЕСПОЛЕЗЕН
CREATE INDEX idx_timestamp ON events (timestamp) TYPE minmax;
-- Если timestamp уникален для каждой строки:
-- min=2024-01-01 10:00:00, max=2024-01-01 10:00:08
-- Почти любой запрос попадет в этот диапазон → индекс не пропустит granule
```

**3. Слишком общие запросы**

```sql
-- ❌ ИНДЕКС НЕ ПОМОЖЕТ
SELECT * FROM events WHERE price > 10;  -- 99% строк подходят
-- minmax индекс не пропустит granules, т.к. почти все подходят
```

**Практический пример: Анализ логов**

```sql
CREATE TABLE logs (
    timestamp DateTime,
    level Enum('DEBUG', 'INFO', 'WARNING', 'ERROR'),
    service String,
    message String,
    trace_id String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (timestamp, service);

-- ✅ ПОЛЕЗНЫЕ индексы:
CREATE INDEX idx_level ON logs (level) TYPE set(10) GRANULARITY 4;
-- level: 4 значения, низкая кардинальность

CREATE INDEX idx_trace_id ON logs (trace_id) TYPE bloom_filter GRANULARITY 4;
-- trace_id: поиск конкретного trace

-- ❌ БЕСПОЛЕЗНЫЕ индексы:
CREATE INDEX idx_timestamp ON logs (timestamp) TYPE minmax;
-- timestamp уже в ORDER BY

CREATE INDEX idx_message_full ON logs (message) TYPE ngrambf_v1(...);
-- слишком дорого, лучше отдельный поисковый движок
```

**Мониторинг эффективности индекса:**

```sql
-- Проверить, используется ли индекс
EXPLAIN indexes = 1
SELECT * FROM logs WHERE trace_id = 'abc123';

-- Если видите:
--   Skip index idx_trace_id: condition = true, used = true ✅

-- Статистика по индексу
SELECT
    table,
    name,
    type,
    expr,
    granularity
FROM system.data_skipping_indices
WHERE table = 'logs';
```

**Правила принятия решения:**

```
Нужен ли skip index?

1. Колонка в PRIMARY KEY?
   → НЕТ индекса

2. Частые фильтры по этой колонке?
   → Возможно ДА

3. Какой тип запросов?
   → = или IN → bloom_filter
   → BETWEEN или > < → minmax
   → низкая кардинальность → set
   → LIKE → ngrambf_v1 (осторожно!)

4. Какая кардинальность в granule?
   → Низкая → эффективен
   → Высокая → бесполезен

5. Протестируйте с EXPLAIN!
```

**Ключевые слова для запоминания:**
Skip index, granule, minmax, bloom_filter, set, ngrambf_v1, false positive, кардинальность, GRANULARITY

---
