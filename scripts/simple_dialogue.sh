#!/bin/bash
echo "Starting simple_dialogue.sh (non-interactive test mode)"

# 1つ目の質問（名前）
if read -r -t 5 -p "What is your name? (default: TestUser in 5s) " NAME_INPUT && [[ -n "$NAME_INPUT" ]]; then
    echo "Name entered: $NAME_INPUT"
else
    NAME_INPUT="TestUser"
    echo "No name entered, using default: $NAME_INPUT"
fi
echo "Hello, $NAME_INPUT!"

# 2つ目の質問（探求）
if read -r -t 5 -p "What is your quest? (default: TestQuest in 5s) " QUEST_INPUT && [[ -n "$QUEST_INPUT" ]]; then
    echo "Quest entered: $QUEST_INPUT"
else
    QUEST_INPUT="TestQuest"
    echo "No quest entered, using default: $QUEST_INPUT"
fi
echo "$NAME_INPUT's quest is to $QUEST_INPUT."

echo "simple_dialogue.sh finished."
exit 0