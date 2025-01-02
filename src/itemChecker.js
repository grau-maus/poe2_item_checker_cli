import { uIOhook, UiohookKey } from 'uiohook-napi';
import { PowerShell } from 'node-powershell';
import * as modData from './json/parsedModData4.json' with { type: 'json' };

const GLOBAL_MOD_DATA = modData.default;
const ITEM_CLASS_STR = 'Item Class: ';
const ITEM_LEVEL_STR = 'Item Level: ';

class ItemDataWatcher {
  isWatching = false;
  lastClipboardContent = '';

  constructor() {
    // Bind the method to maintain correct 'this' context
    this.handleKeyPress = this.handleKeyPress.bind(this);
  }

  async start() {
    console.log('Starting item data watcher...');
    console.log('Press Ctrl + Alt + C while hovering over an item to capture its data');
    console.log('Press Ctrl + Q to quit');

    this.isWatching = true;

    uIOhook.on('keydown', this.handleKeyPress);
    uIOhook.start();
  }

  async stop() {
    console.log('Stopping item data watcher...')
    this.isWatching = false;
    uIOhook.stop();
    process.exit(0);
  }

  async handleKeyPress(event) {
    if (event.ctrlKey && event.keycode === UiohookKey.Q) {
      await this.stop();
      return;
    }

    if (event.ctrlKey && event.altKey && event.keycode === UiohookKey.C) {
      setTimeout(async () => {
        try {
          const cbPromise = PowerShell.$`Get-Clipboard`;
          
          cbPromise.then((res) => {
            // console.log(res);

            const clipboardContent = res.raw;

            if (clipboardContent !== this.lastClipboardContent) {
              this.lastClipboardContent = clipboardContent
  
              if (this.isPoeItem(clipboardContent)) {
                const itemData = clipboardContent.split('\r\n');
                const modScore = [];
                let itemClass = '';
                let itemName = '';
                let itemLevel = 0;
                let parsedRarity = false;

                for (const lineItem of itemData) {
                  // console.log(lineItem);

                  if (parsedRarity && itemName === '') {
                    itemName = lineItem;
                  }
                  if (!parsedRarity && lineItem.includes('Rarity: ')) {
                    parsedRarity = true;
                  }

                  if (
                    itemLevel !== 0 
                    && lineItem != '--------' 
                    && !lineItem.includes('(implicit)')
                    && !lineItem.includes('Note:')
                    && lineItem !== 'Corrupted'
                    && lineItem !== 'Can only be equipped if you are wielding a Bow.'
                  ) {
                    const values = [];
                    const strVals = lineItem.match(/\d+(\.\d+)?/g);
                    let sanitizedModTxt = lineItem;
                    let isCompared = false;
                    let prevSingleVal = 0;

                    if (strVals) {
                      for (const strVal of strVals) {
                        sanitizedModTxt = sanitizedModTxt.replace(strVal, '');
                        values.push(Number(strVal));
                      }
                    }

                    sanitizedModTxt = sanitizedModTxt.replaceAll(' ', '');

                    const refMods = GLOBAL_MOD_DATA[itemClass][sanitizedModTxt].mods;
                    const tiers = GLOBAL_MOD_DATA[itemClass][sanitizedModTxt].tiers;

                    if (!refMods) {
                      throw new Error('Unable to reference mod data...');
                    }

                    for (let i = 0; i < refMods.length; i++) {
                      const currMod = refMods[i];
                      const isMultiMod = currMod.isMultiMod;
                      const itemModLowVal = values[0];
                      const itemModHighVal = values.length > 1 ? values[1] : null;

                      if (isMultiMod) {
                        // TODO: HANDLE MULTI MOD COMPARE
                        throw new Error('CONTAINS SPECIAL MOD');
                      } else {
                        const isSingleVal = currMod.ranges.hasSingleVal;
                        const currModLowRanges = currMod.ranges.low;
                        const currModHighRanges = currMod.ranges.high;
                        const currModLowRangeLow = currModLowRanges[0];
                        const currModLowRangeHigh = currModLowRanges.length > 1 ? currModLowRanges[1] : null;
                        const isHighest = itemModLowVal > prevSingleVal && itemModLowVal <= currModLowRangeLow;
                        const validSingleNumComp = (
                          itemModHighVal === null 
                          && currModLowRangeHigh === null 
                          && isSingleVal
                          && (
                            (
                              itemModLowVal >= prevSingleVal
                              && itemModLowVal < currModLowRangeLow
                            ) || isHighest
                          )
                        );
                        let currModHighRangeLow;
                        let currModHighRangeHigh;

                        if (!isSingleVal) {
                          currModHighRangeLow = currModHighRanges[0];
                          currModHighRangeHigh = currModHighRanges.length > 1 ? currModHighRanges[1] : null;
                        }

                        if (
                          validSingleNumComp
                          || (
                            itemModLowVal >= currModLowRangeLow 
                            && currModLowRangeHigh && itemModLowVal <= currModLowRangeHigh
                            && (
                              isSingleVal
                              || (
                                itemModHighVal
                                && currModHighRangeLow
                                && itemModHighVal >= currModHighRangeLow
                                && currModHighRangeHigh
                                && itemModHighVal <= currModHighRangeHigh
                              )
                            )
                          )
                        ) {
                          isCompared = true;
                          modScore.push(
                            {
                              text: lineItem,
                              score: `${i + (validSingleNumComp ? (isHighest ? 1 : 0) : 1)}/${this.getHighestPossibleTier({
                                tiers,
                                itemLevel
                              })}`
                            }
                          );

                          break;
                        } else if (itemModLowVal < currModLowRangeLow) {
                          isCompared = true;
                          modScore.push(
                            {
                              text: lineItem,
                              score: `0/${this.getHighestPossibleTier({
                                tiers,
                                itemLevel
                              })}`
                            }
                          );

                          break;
                        }

                        prevSingleVal = currModLowRangeLow;
                      }
                    }

                    if (!isCompared) {
                      modScore.push(
                        {
                          text: lineItem,
                          score: `?/${this.getHighestPossibleTier({
                            tiers,
                            itemLevel
                          })}`
                        }
                      );
                      // console.log(lineItem);
                      // throw new Error('Unable to find mod to compare with');
                    }
                  }
                  if (lineItem.includes(ITEM_CLASS_STR)) {
                    itemClass = lineItem.split(ITEM_CLASS_STR)[1];
                  }
                  if (lineItem.includes(ITEM_LEVEL_STR)) {
                    itemLevel = Number(lineItem.split(ITEM_LEVEL_STR)[1]);
                  }
                }

                console.log('----------');
                console.log(`${itemName} (${itemClass}):`);
                for (const scoreData of modScore) {
                  const {text, score} = scoreData;

                  console.log(`${score}: ${text}`);
                }
                console.log('----------');
              } else {
                console.log();
                if (clipboardContent.includes('Rarity: Unique')) {
                  console.error('Uniques not yet supported');
                } else {
                  console.error('Item not supported');
                }
                console.log();
              }
            }
          });
        } catch (error) {
          console.error('Error reading clipboard:', error);
        }
      }, 100);
    }
  }

  getHighestPossibleTier({tiers, itemLevel}) {
    let prevTier = 0;
    let highestPossibleTierLevel = 0;

    for (let j = 0; j < tiers.length; j++ ) {
      const tier = tiers[j];

      if (itemLevel >= prevTier && itemLevel < tier) {
        highestPossibleTierLevel = j + 1;
        
        break;
      } else if (itemLevel >= tier && (j + 1) === tiers.length) {
        highestPossibleTierLevel = tiers.length;
      }

      prevTier = tier;
    }

    return highestPossibleTierLevel;
  }

  isPoeItem(text) {
    return (
      !text.includes('Rarity: Unique')
      && !text.includes('Rarity: Currency')
      && !text.includes('Item Class: Jewels')
      && !text.includes('Item Class: Mana Flasks')
      && !text.includes('Item Class: Life Flasks')
      && !text.includes('Item Class: Charms')
      && !text.includes('Item Class: Inscribed Ultimatum')
      && !text.includes('Item Class: Trial Coins')
      && !text.includes('Item Class: Waystone')
      && !text.includes('Item Class: Stackable Currency')
      && (
        text.includes('Rarity: ') 
        || text.includes(ITEM_LEVEL_STR) 
        || text.includes('Requirements:')
      )
    );
  }
}

async function main() {
  const watcher = new ItemDataWatcher();

  process.on('SIGINT', async () => {
    await watcher.stop();
    process.exit();
  })

  await watcher.start();
}

main().catch(console.error);