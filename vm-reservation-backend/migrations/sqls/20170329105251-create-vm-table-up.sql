CREATE TABLE vms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    description VARCHAR,
    contact VARCHAR,
    bookingtime VARCHAR,
    systeminfo VARCHAR,
    ansible_facts VARCHAR
);
