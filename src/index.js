const path = require('path');
const fse = require('fs-extra');
const {Proskomma} = require('proskomma-core');
const {
    render,
    PerfRenderFromProskomma,
    SofriaRenderFromProskomma
} = require('proskomma-json-tools');

// CLI stuff
const USAGE = "USAGE: node src/index.js <usfm>";

if (process.argv.length !== 3) {
    throw new Error(`Expected exactly 1 argument, not ${process.argv.length - 2}\n${USAGE}`);
}

const filename = path.resolve(process.argv[2]);
if (!fse.existsSync(filename)) {
    throw new Error(`USFM path ${filename} does not exist`);
}
let usfm;
try {
    usfm = fse.readFileSync(filename).toString();
} catch (err) {
    throw new Error(`Could not load USFM file ${filename}: ${err}`);
}

// Load content into Proskomma
const pk = new Proskomma();
pk.importDocument({"lang": "xxx", "abbr": "yyy"}, "usfm", usfm);

// Get 'just the text', by verse, via a query
const bcvQuery = `
{
   documents {
      id
      bookCode: header(id: "bookCode")
      cvIndex(chapter: 2) {
         chapter
         verses {
            verse {
               verseRange
               text
            }
         }
      }
   }
}
`;
let result = pk.gqlQuerySync(bcvQuery);
const docId = result.data.documents[0].id;
console.log(JSON.stringify(result, null, 2));

// Get tokenized text by paragraph, via a query
const paraQuery = `
{
   documents {
      bookCode: header(id: "bookCode")
      mainSequence {
         blocks(withScriptureCV: "2:3-6") {
            bs {
               payload
            }
            items(withScriptureCV: "2:3-6") {
               type
               subType
               payload(normalizeSpace: true)
            }
         }
      }
   }
}
`;
result = pk.gqlQuerySync(paraQuery);
console.log(JSON.stringify(result, null, 2));

// Render to "standard" HTML via SofriaRender

const config = {
    showWordAtts: false,
    showTitles: false,
    showHeadings: true,
    showIntroductions: true,
    showFootnotes: true,
    showXrefs: true,
    showParaStyles: true,
    showCharacterMarkup: true,
    showChapterLabels: true,
    showVersesLabels: true,
    selectedBcvNotes: [],
    renderers: render.sofria2web.sofria2html.renderers,
};

const sofriaRenderer = new SofriaRenderFromProskomma(
    {
        proskomma: pk,
        actions: render.sofria2web.renderActions.sofria2WebActions,
        debugLevel: 0
    }
);
let output = {};
sofriaRenderer.renderDocument({docId, config, output});
console.log(output.paras);

// DIY rendering from PERF

const myPerfActions = {
    startDocument: [
        {
            description: "Set up workspace and output",
            test: () => true,
            action: ({workspace}) => {
                workspace.chapter = null;
                workspace.verses = null;
                output.verses = [];
            }
        }
    ],
    mark: [
        {
            description: "Update CV state",
            test: () => true,
            action: ({context, workspace, output}) => {
                const element = context.sequences[0].element;
                if (element.subType === "chapter") {
                    workspace.chapter = element.atts["number"];
                    workspace.verses = null;

                } else if (element.subType === "verses") {
                    workspace.verses = element.atts["number"];
                    output.verses.push({cv: `${workspace.chapter}:${workspace.verses}`, text: []})
                }
            }
        }
    ],
    text: [
        {
            description: "Add text to current verse record",
            test: () => true,
            action: ({context, workspace, output}) => {
                const element = context.sequences[0].element;
                output.verses[output.verses.length - 1].text.push(element.text);
            }
        },
    ]
};

const perfRenderer = new PerfRenderFromProskomma(
    {
        proskomma: pk,
        actions: myPerfActions,
        debugLevel: 0
    }
);
output = {};
perfRenderer.renderDocument({docId, config, output});
console.log(
    output.verses
        .map(
            vr => `${vr.cv} => ${vr.text.join('')}`
        )
        .join('\n')
);