Таблицы:

**record**
- id
- link_name
- title
- category
- tags
- content
- meta
- created_at
- updated_at
- version

**links**
- from_record
- to_record

**record_acess**
- record_id
- org
- level

# Категории статей (теги)
- События
- Кампании
- Персонажи
- Организации
- Страны
- Технологии

# Взаимодействие с картой

# Таймлайн

# Мета-информация (инфобокс)
Должен быть максимально гибким. Тот кто пишет статью не пишет по шаблону он может буквально добавлять в инфобокс свои разделы и наполнять его нужным себе контентом.

Условно:

Досье:
- **Позывной:** "Кремень"
- **Имя:** Джон
- **Фамилия:** Сноу
- **Пол:** Мужской
- **Дата рождения:** ||Неизвестно||
- **Статус:** tag(Неизвестно, gray)

Организации:
table {
    header:
        - Название
        - С
        - По
    records:
        [[Протокол Аполлон|apollo_protocol]], timestamp(2027.03.20), timestamp()
}

Анализ:
- bar(Опасность, 100, 80)
- bar(Уважение, 100, 80)
- dotbar(Рейтинг, 5, 3.5)

## ВИДЖЕТЫ
- tag(content, style, hex_code)
- bar(name, max, current)
- dotbar(name, max, current)
- table {
    header:
        - col1
        - col2
        - col3
        ...
    records:
        - col11, col21, col31
        - col12, col22, col32
        - col13, col23, col33
        ...
}
- map(zoom, lat, lng)
- image(header, footer, url)
- gallery {
    - header, footer, url
    - header2, footer2, url2
}
- quote(author, date, content)
- discord_msg {
    - discord_message_url
    - discord_message_url2
    - discord_message_url3
}
- countdown(date, time)
- timestamp(date, time)


Как должны храниться данные про роли организаций в аутентификации:
org:
- tag
- name
- role_id

org_access:
- id
- org_tag (fk -> org.tag)
- label
- lvl
- permissions

access_roles:
- access_id (fk -> org_acess.id)
- discord_role_id

Когда чел заходит через дискорд мы записываем ID его ролей а не названия ролей. Затем когда он открывает какую-нибудь статью мы смотрим:
- Является ли он админом
- Есть ли у него роль организации
- Есть ли у него org_access достаточного уровня за счёт его ролей, чтобы её просматривать