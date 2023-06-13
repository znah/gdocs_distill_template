var userProps = PropertiesService.getUserProperties(); 
var body = DocumentApp.getActiveDocument().getBody();
var consts = parseConstants();

// simple sanitize HTML from SO. for avoiding facepalm bugs and not for any sort of strict security.
// https://stackoverflow.com/questions/24816/escaping-html-strings-with-jquery/12034334#12034334
var entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

var inverseEntityMap = {
  '&amp;' : '&',
  '&lt;' : '<',
  '&gt;' : '>',
  '&quot;' : '"',
  '&#39;' : "'",
  '&#x2F;' : '/',
  '&#x60;': '`',
  '&#x3D;' : '='
};

function escapeHtml (string) {
  return String(string).replace(/[&<>"'`=\/]/g, function (s) {
    return entityMap[s];
  });
}

function unEscapeHtml (string) {
  return String(string).replace(/&[a-z0-9#A-Z]*;/g, function (s) {
    return inverseEntityMap[s];
  });
}


function onOpen() {
  DocumentApp.getUi()
      .createMenu('HTML Export')
      .addItem('Set GitHub API key', 'setApiKey')
      .addItem('Run Export', 'ConvertGoogleDocToCleanHtml')
      .addItem('Download HTML', 'DownloadHTML')
      .addToUi();
}

function setApiKey(){
  const ui = DocumentApp.getUi();
  var response = ui.prompt('Please copy and paste a personal access token from "https://github.com/settings/tokens"');
  if (response.getSelectedButton() == ui.Button.OK) {
    userProps.setProperty('apikey', response.getResponseText());
  } else {
    throw new Error("No key entered.");
  };
};

function checkAndParseGitURL(consts){
  if (!("github_repo" in consts)) { throw new Error("Please add 'github_repo' to the consts table") };
  let github_repo = consts["github_repo"];
  if (github_repo.endsWith(".html")) {
    var htmlMatch = /https:\/\/github.com\/(.*)\/(.*)\/blob\/(.*)\/(.*).html/;
    if (!htmlMatch.test(github_repo)) { throw new Error("Unrecognized repository URL."); };
    github_repo = github_repo.replace(htmlMatch, "https://api.github.com/repos/$1/$2/contents/$4.html");
  } else {
    var canonMatch = /https:\/\/github.com\/(.*?)\/(.*?)\/?$/;
    if (!canonMatch.test(github_repo)) { throw new Error("Unrecognized repository URL."); };
    github_repo = github_repo.replace(canonMatch, "https://api.github.com/repos/$1/$2/contents/docs/article.html");
  }
  consts["github_repo"] = github_repo;
  return consts;
};

function parseConstants() {
  let tables = body.getTables();
  // The first table should be our constants. 
  if (tables.length == 0) {
    throw new Error("Constants table is not available or has been removed.");
  };
  let table = tables[0];
  var consts = {};
  for (let i=0; i < table.getNumRows(); i++) {
    let row = table.getRow(i);
    if (row.getNumCells() != 2){
      throw new Error("All rows in constants table should have two columns - key/value.");
    }
    consts[row.getCell(0).getText()] = row.getCell(1).getText();
  }
  return consts;
}  

function GenerateHTML() {
  var output = [];
  let foundStart = false;
  const consts = parseConstants();
  const n = body.getNumChildren();
  for (let i=0; i<n; ++i) {
    const p = body.getChild(i);
    const text = p.getText().trim();
    foundStart |= (text == '<d-article>');
    if (!foundStart)
      continue;
    output.push(processItem(p, consts, false));
  }
  const html = output.join('\n');
  return html;
}

function DownloadHTML() {
  const htmlOutput = HtmlService
    .createHtmlOutput(`
    <script>
    function buttonclicked() {
      const status = document.getElementById('status');
      status.innerText = 'exporting...';
      google.script.run.withSuccessHandler(html=>{
        navigator.clipboard.writeText(html).then(()=>{
          status.innerText = 'done';
        });
      }).GenerateHTML();
    }
    </script>
    <button onclick='buttonclicked();'>Copy</button><p id="status"></p>`)
    .setTitle('HTML Export');
  DocumentApp.getUi().showSidebar(htmlOutput);
}

function ConvertGoogleDocToCleanHtml() {
  const html = GenerateHTML();
  var htmlb64 = Utilities.base64Encode(html, Utilities.Charset.UTF_8);
  
  //Check for saved GitHub url and token, else prompt for it.  
  consts = checkAndParseGitURL(consts);
  if (userProps.getProperty("apikey") == null){ setApiKey(); };
  
  try {
    var response = UrlFetchApp.fetch(consts["github_repo"], {
      'method' : 'GET',
      'headers': {
        'Authorization': 'token ' + userProps.getProperty("apikey") //'
      }
    });
  } catch (e) {
    throw new Error('Failed to connect to GitHub API with error: ' + e + '. Please check the GitHub repository URL or the access token.');
  }
  var articlefile = JSON.parse(response.getContentText());
  
  try {
    UrlFetchApp.fetch(consts["github_repo"], {
      'method' : 'PUT',
      'payload' : JSON.stringify({
        "message": "auto update article.html",
        "sha": articlefile.sha,
        "committer": {
          "name": "selforg-bot",
          "email": "selforg@google.com"
        },
        "content": htmlb64
      }),
      'headers': {
        'Authorization': 'token ' + userProps.getProperty("apikey") //'
      }
    });
  } catch (e) {
    throw new Error('Failed to write to GitHub repository with error: ' + e + '. Please make sure you have write permission.');
  }
  DocumentApp.getUi().alert('Successfully exported article HTML to GitHub');
}


function dumpAttributes(atts) {
  // Log the paragraph attributes.
  for (var att in atts) {
    Logger.log(att + ":" + atts[att]);
  }
}

function processItem(item, consts, isCode) {
  var output = [];
  var prefix = "", suffix = "";
  if (item.getType() == DocumentApp.ElementType.PARAGRAPH) {
    var title = ""
    title = item.getText();
    title = title.replace(/[^A-Za-z0-9 ']/g, "").toLowerCase().split(" ").join("-");
    switch (item.getHeading()) {
      case DocumentApp.ParagraphHeading.HEADING6: 
        prefix = "<h6 id='" + title + "'>", suffix = "</h6>"; break;
      case DocumentApp.ParagraphHeading.HEADING5: 
        prefix = "<h5 id='" + title + "'>", suffix = "</h5>"; break;
      case DocumentApp.ParagraphHeading.HEADING4:
        prefix = "<h4 id='" + title + "'>", suffix = "</h4>"; break;
      case DocumentApp.ParagraphHeading.HEADING3:
        prefix = "<h3 id='" + title + "'>", suffix = "</h3>"; break;
      case DocumentApp.ParagraphHeading.HEADING2:
        prefix = "<h2 id='" + title + "'>", suffix = "</h2>"; break;
      case DocumentApp.ParagraphHeading.HEADING1:
        prefix = "<h1>", suffix = "</h1>"; break;
      case DocumentApp.ParagraphHeading.SUBTITLE:
        isCode = true; break;
      default: 
       prefix = "<p>", suffix = "</p>";
    }

    if (item.getNumChildren() == 0)
      return "";

    if (item.getNumChildren() == 1 ) {
      const childType = item.getChild(0).getType();
      if (childType == DocumentApp.ElementType.INLINE_IMAGE ||
          childType == DocumentApp.ElementType.INLINE_DRAWING) {
        // for custom figure properties we can add those ourselves.
        const alt = item.getChild(0).getAltDescription();
        if (alt && !alt.startsWith("<figure")) {
          prefix = "<figure>";
          suffix = "</figure>";
        }
      }
    }
  } else if (item.getType() == DocumentApp.ElementType.FOOTNOTE) {
    prefix = "<d-footnote>";
    suffix = "</d-footnote>";
    // TODO(eyvind@): footnotes in the distill template don't support nested paragraphs. 
    // so we hope it's a short footnote, and take the first one as a quick and dirty hack.
    item = item.getFootnoteContents().getParagraphs()[0];
    //output.push("<d-footnote>");
    //processText(item.getFootnoteContents().editAsText(), output, false);
    //output.push("</d-footnote>");
  } else if (item.getType()===DocumentApp.ElementType.LIST_ITEM) {
    // check if we are already in a list
    prefix = "<li>";
    suffix = "</li>";
    var textnow = item.getText();
    // case when starting a list
    if (!item.getPreviousSibling() || item.getPreviousSibling().getType() != DocumentApp.ElementType.LIST_ITEM) {
      prefix = "<ul>".repeat(item.getNestingLevel() + 1) + prefix;
    }
    
    // add sufficient new lists or end sufficient lists to match the next nesting level
    var postDiffLevel = (!item.getNextSibling() || item.getNextSibling().getType() != DocumentApp.ElementType.LIST_ITEM) ? 
      (item.getNestingLevel() + 1) : (item.getNestingLevel() - item.getNextSibling().getNestingLevel());
    
    if (postDiffLevel > 0) {
        suffix = suffix + "</ul>".repeat(postDiffLevel);
    } else {
        suffix = suffix + "<ul>".repeat(-postDiffLevel);
    }
  }
  if (item.getType() == DocumentApp.ElementType.TEXT) {
    processText(item, output, isCode);
  }
  else {
    if (item.getNumChildren) {
      var numChildren = item.getNumChildren();

      // Walk through all the child elements of the doc.
      for (var i = 0; i < numChildren; i++) {
        var child = item.getChild(i);
        output.push(processItem(child, consts, isCode));
      }
    }
  }
  output = output.join('');
  if (output.length == 0) {
    return "";
  }
  return prefix + output + suffix;
}

function processString(s) {
  //remove smart quotes if they are enabled
  s = s.replace(/(‘|’)/g, "'");
  s = s.replace(/(“|”)/g, '"');
  s = s.replace(/\[\[([^\[\]]+)\]\]/g, '<d-cite key="$1"></d-cite>');
  if ("colab" in consts) { 
    var colablink = "<a href=\"" + consts['colab'] + "#scrollTo=$1\" target=\"_blank\" class=\"colab-root\">Reproduce in a <span class=\"colab-span\">Notebook</span></a>";
    s = s.replace(/colab\(([a-zA-Z0-9_-]+)\)/gm, colablink);
  };

  function replacer(match, p1, p2, offset, string, groups) {
    var colablink = `<a href="` + unEscapeHtml(p1) + `" class="colab-root"><span class="colab-span">` + p2 + `</span></a>`;
    return colablink;
  }
  s = s.replace(/colablink\(([a-zA-Z0-9_\-@:;&%._\+~#=\/]+),([a-zA-Z0-9 ]+)\)/gm, replacer);

  return s;
}

function processText(item, output, isCode) {
  const text = item.getText();
  if (isCode) {
    output.push(processString(text));
    return;
  }

  var indices = item.getTextAttributeIndices();
  var inLink = false;

  for (var i=0; i < indices.length; i ++) {
    const startPos = indices[i];
    const endPos = i+1 < indices.length ? indices[i+1]: text.length;
    const partText = text.substring(startPos, endPos);
    const partAtts = item.getAttributes(startPos);
    const font = item.getFontFamily(startPos);

    if (!inLink && partAtts.LINK_URL) {
      //beggining of link
      inLink = true;
      output.push("<a href='" + partAtts.LINK_URL + "'>");
    }
    if (inLink && !partAtts.LINK_URL){
      //end of link
      inLink = false;
      output.push("</a>");
    }
    if (partAtts.ITALIC) {
      output.push('<i>');
    }
    if (partAtts.BOLD) {
      output.push('<strong>');
    }
    if (partAtts.UNDERLINE && !partAtts.LINK_URL) {
      output.push('<u>');
    }
    if (font == 'Consolas') {
      output.push('<code>');
    }
    
    output.push(processString(escapeHtml(partText)));

    if (font == 'Consolas') {
      output.push('</code>');
    }

    if (partAtts.ITALIC) {
      output.push('</i>');
    }
    if (partAtts.BOLD) {
      output.push('</strong>');
    }
    if (partAtts.UNDERLINE && !partAtts.LINK_URL) {
      output.push('</u>');
    }
  }
}
