var Trelala = (function(){
    var _storySize = {
        small: 1,
        medium: 2,
        large: 4
    }

    function createPercentageCompleteChart(id, complete, size) {
        if (typeof complete === 'string') {
            complete = parseFloat(complete)
        }
        remainder = 100.0 - complete
        title = complete.toString() + "%"
        fontSize = size < 180 ? '16px' : '24px'
        innerSize = size <= 100 ? '75%' : '70%'
        yOffset = size < 180 ? 8 : 12;

        var colors = ['#BBBBBB', '#00CC66', '#F7464A'];
        $(id).highcharts({
            chart: {
                type: 'pie',
                height: size,
                width: size,
                borderRadius: 0,
                spacing: 0
            },
            credits: {
                enabled: false
            },
            title: {
                text: title,
                align: 'center',
                verticalAlign: 'middle',
                y: yOffset,
                style: { fontSize: fontSize }
            },
            tooltip: false,
            plotOptions: {
                pie: {
                    borderWidth: 3,
                    startAngle: 90,
                    innerSize: innerSize,
                    size: '100%',
                    shadow: false,
                    dataLabels: false,
                    stickyTracking: false,
                    states: {
                        hover: {
                            enabled: false
                        }
                    }
                }
            },
            legend: {
                enabled: false
            },
            series: [{
                data: [
                    { y: remainder, color: colors[0] },
                    { y: complete, color: colors[1] }
                ]
            }]
        });
    }

    function addWeekdays(date, days) {
        date = moment(date); // use a clone
        while (days > 0) {
            date = date.add(1, 'days');
            // decrease "days" only if it's a weekday.
            if (isBusinessDay(date)) {
                days -= 1;
            }
        }
        return date;
    }

    function isBusinessDay(date)
    {
        return (date.isoWeekday() !== 6 && date.isoWeekday() !== 7);
    }

    function isActiveCol(list) {
        return list != null
            && (list.name.indexOf('Analysis Complete') != -1
                || list.name.indexOf('Design') != -1
                || list.name.indexOf('Implementation') != -1
                || list.name.indexOf('Verification') != -1
                || list.name.indexOf('Release Ready') != -1);
    }

    function getCardListStoryUnits(cards) {
        var storyUnits = 0;
        $.each(cards, function(i, card) {
            if (!card.name) return true;
            storyUnits += getCardStoryUnits(card.name);
        });
        return storyUnits;
    }

    function getCardStoryUnits(cardName){
        var match = cardName.match(/\[([SML])\]/i);
        var storyUnits = 0;

        if (match != null) {
            switch (match[1]) {
                case 'S':
                case 's':
                    storyUnits = _storySize.small;
                    break;
                case 'M':
                case 'm':
                    storyUnits = _storySize.medium;
                    break;
                case 'L':
                case 'l':
                    storyUnits = _storySize.large;
                    break;
            }
        }

        return storyUnits;
    }

    function getBoardSummaryData(boardId) {
        var plannedStoryUnits = 0;
        var currentStoryUnits = 0;
        var storyUnitsComplete = 0;
        var blockedDays = 0;
        var meta;

        var formatDate = function(date) {
            var momentDate = moment(date);
            return momentDate.isValid() ? momentDate.format('MM/DD/YYYY') : 'TBD';
        };

        var deferred = $.Deferred();

        Trello
            .get('boards/' + boardId + '/lists?cards=open')
            .success(function(lists) {
                $.each(lists, function(ix, list) {
                    if (isActiveCol(list)) {
                        currentStoryUnits += getCardListStoryUnits(list.cards);
                    }

                    if (list.name.indexOf('Release Ready') != -1) {
                        storyUnitsComplete += getCardListStoryUnits(list.cards);
                    }

                    blockedDays += getTotalBlockedDays(list.cards);
                });

                meta = extractMetadata(lists).meta;

                var storyUnitsLeft = currentStoryUnits - storyUnitsComplete;
                var projectedDoneDate = addWeekdays(new Date(), storyUnitsLeft / meta.teamVelocity);

                if (formatDate(meta.analysisCompleteDate) !== 'TBD') {
                    var before = moment(meta.analysisCompleteDate).add('days', 1).toISOString();

                    Trello.get('boards/' + boardId + '/cards', { limit: 1000, filter: ['all'] })
                        .success(function(currentCards) {
                            Trello.get('boards/' + boardId + '/actions', {
                                before: before,
                                limit: 1000,
                                filter: [
                                    'createCard',
                                    'copyCard',
                                    'deleteCard',
                                    'moveCardFromBoard',
                                    'moveCardToBoard',
                                    'updateCard'
                                ]
                            }).success(function(actions) {
                                actions.sort(function(action1, action2) {
                                    return (action1.date < action2.date ? 1: -1);
                                });

                                var cards = [];
                                var cardIds = [];

                                $.each(actions, function(i, action) {
                                    if (action.data.card != null
                                        && $.inArray(action.data.card.id, cardIds) == -1
                                        && ((action.data.list != null && isActiveCol(action.data.list))
                                            || (action.data.listAfter != null && isActiveCol(action.data.listAfter)))) {

                                        $.each(currentCards, function(i, currentCard) {
                                            if (currentCard.id === action.data.card.id) {
                                                cards.push(currentCard);
                                            }
                                        });

                                        cardIds.push(action.data.card.id);
                                    }
                                });

                                plannedStoryUnits = getCardListStoryUnits(cards);

                                percentComplete = (storyUnitsComplete / currentStoryUnits * 100).toFixed()
                                deferred.resolve({
                                    confidence: meta.confidence,
                                    projectedDoneDate: formatDate(projectedDoneDate),
                                    kickoffDate: formatDate(meta.kickoffDate),
                                    analysisCompleteDate: formatDate(meta.analysisCompleteDate),
                                    releaseReadyDate: formatDate(meta.releaseReadyDate),
                                    releasedOn: formatDate(meta.releasedOn),
                                    plannedStoryUnits: plannedStoryUnits,
                                    currentStoryUnits: currentStoryUnits,
                                    storyUnitsComplete: storyUnitsComplete,
                                    percentComplete: percentComplete,
                                    percentCompleteLabel: percentComplete + '%',
                                    totalBlockedDays: blockedDays
                                });
                            });
                        });
                } else {
                    percentComplete = (storyUnitsComplete / currentStoryUnits * 100).toFixed()
                    deferred.resolve({
                        confidence: meta.confidence,
                        projectedDoneDate: formatDate(projectedDoneDate),
                        kickoffDate: formatDate(meta.kickoffDate),
                        analysisCompleteDate: formatDate(meta.analysisCompleteDate),
                        releaseReadyDate: formatDate(meta.releaseReadyDate),
                        releasedOn: formatDate(meta.releasedOn),
                        plannedStoryUnits: plannedStoryUnits,
                        currentStoryUnits: currentStoryUnits,
                        storyUnitsComplete: storyUnitsComplete,
                        percentComplete: percentComplete,
                        percentCompleteLabel: percentComplete + '%'
                    });
                }
            });

        return deferred.promise();
    }

    function getTotalBlockedDays(cards) {
        var blockedDays = 0;
        $.each(cards, function(i, card) {
            if (!card.name) return -1;

            var match = card.name.match(/\(\s*\d+\s*(days)*\s*\)/);
            if (match && match[0]) {
                var numberMatch = match[0].match(/\d+/);
                if (numberMatch && numberMatch[0]) {
                    blockedDays += parseInt(numberMatch[0]);
                }
            }

        });

        return blockedDays;
    }

    function getScopeChangeHistory(boardId) {
        var $scopeChange = $("<div />");
        var $tableScope = $("<table></table>").addClass('confluenceTable');

        $('<th>Change Date</th>').addClass('confluenceTh').appendTo($('<tr></tr>')).appendTo($tableScope);
        $('<th>Change Summary</th>').addClass('confluenceTh').appendTo($('<tr></tr>')).appendTo($tableScope);
        $('<th>Scope Change</th>').addClass('confluenceTh').appendTo($('<tr></tr>')).appendTo($tableScope);
        $('<th>Reason</th>').addClass('confluenceTh').appendTo($('<tr></tr>')).appendTo($tableScope);

        getMetadata(boardId).done(function(data) {
           Trello.get('boards/' + boardId + '/actions?filter=createCard,copyCard,updateCard:idList,moveCardFromBoard,moveCardToBoard,updateCard:closed', { limit: 1000 })
           .success(function (actions) {
                //get card with analyis complete date
                var analysisCompleteDate = data.meta.analysisCompleteDate;
                var teamVelocity = data.meta.teamVelocity;

                if (analysisCompleteDate !== null) {
                    $.each(actions, function (ix, action) {
                        if (action.type === "createCard" || action.type === "copyCard" || action.type === "moveCardFromBoard" || action.type === "moveCardToBoard") {
                            if (isActiveCol(action.data.list)) {
                                var daysDiff = moment(moment(action.date)).diff(moment(analysisCompleteDate), 'days');
                                if (daysDiff > 0) {
                                    var weight = "+";
                                    if (action.type === "moveCardFromBoard") { weight = "-"; }
                                    //get current state of the card
                                    appendRowToTable(action.data.card.id, action.date, $tableScope, weight, teamVelocity, action.data.card.name);
                                }
                            }
                        }
                        else {
                            //TODO: Archived items
                            if (action.type === "updateCard" && action.data.card.closed) {
                                if (moment(action.date).diff(moment(analysisCompleteDate), 'days') > 0) {
                                    Trello.get('cards/' + action.data.card.id + '/list', function(singlelist) {
                                        if (isActiveCol(singlelist)) {
                                            appendRowToTable(action.data.card.id, action.date,  $tableScope, "-", teamVelocity, action.data.card.name);
                                        }
                                    });
                                }
                            } else if (!isActiveCol(action.data.listBefore) && isActiveCol(action.data.listAfter)
                            && (moment(action.date).diff(moment(analysisCompleteDate), 'days') > 0)) {
                                appendRowToTable(action.data.card.id, action.date,  $tableScope, "+", teamVelocity, action.data.card.name);
                            } else if (isActiveCol(action.data.listBefore) && !isActiveCol(action.data.listAfter)
                            && (moment(action.date).diff(moment(analysisCompleteDate), 'days') > 0)) {
                                appendRowToTable(action.data.card.id, action.date, $tableScope, "-", teamVelocity, action.data.card.name);
                            }
                        }
                    });
                }
            });
        });

        $tableScope.appendTo($scopeChange);

        return $scopeChange;
    }

    function appendRowToTable(id, date, $tableScope, weight, teamVelocity, name) {

        var row = $('<tr></tr>');

        $('<td>' + moment(date).format('L') + '</td>').addClass('confluenceTd').appendTo(row);
        var $columnName = $('<td></td>');
        var $columnScopeChange = $('<td></td>');


        $columnName.addClass('confluenceTd').appendTo(row);
        //calculate card points before date
        $columnScopeChange.addClass('confluenceTd').appendTo(row);

        Trello.get('cards/' + id, function(card) {
            $columnName.text(card.name);

            if (!card.name) return true;
            var storyUnits = getCardStoryUnits(card.name);

            $columnScopeChange.text(weight + Math.round((storyUnits / teamVelocity) * 100) / 100 + ' day(s)');

            // get reason from description
            $('<td>' + card.desc + '</td>').addClass('confluenceTd').appendTo(row);
        });

        row.appendTo($tableScope);
    }


    //************************************
    // Frequency Chart functions
    //************************************

    function drawFrequency(boardId, targetElement) {
        $.when(
            getReleaseReadyActions(boardId),
            getLists(boardId),
            getMetadata(boardId))
        .done(function (cardDataResult, lists, metaData) {
            var cards =  $.map(cardDataResult, function(card, id) {
                var dates = findStartEndDates(card, lists);
                var daysToComplete = Math.ceil(dates.doneDate.diff(dates.startDate, 'minutes') / 1440);
                return {
                    name: card.name,
                    id: card.id,
                    startDate: dates.startDate,
                    doneDate: dates.doneDate,
                    daysToComplete: daysToComplete
                };
            });

            cards.sort(compareSeriesCards);
            var series = getFrequencySeries(cards);

            drawFrequencyChart(cards, series, targetElement, metaData);
        });
    }

    function findStartEndDates(card, lists) {
        var startDate = null;
        var doneDate = null;
        var analysisCompleteId = null;
        var designId = null;
        var implementationId = null;
        var releaseReadyId = null;
        var verificationId = null;

        $.each(lists.lists, function(id, list){
            if (list.listName.indexOf('Analysis Complete') != -1) analysisCompleteId = list.listId;
            if (list.listName.indexOf('Design') != -1) designId = list.listId;
            if (list.listName.indexOf('Implementation') != -1) implementationId = list.listId;
            if (list.listName.indexOf('Release Ready') != -1) releaseReadyId = list.listId;
            if (list.listName.indexOf('Verification') != -1) verificationId = list.listId;

        });

        for (var i = card.actions.length -1; i >= 0; i--) {
            var action = card.actions[i];
            if (action.actionType == 'moveCardToBoard'){
                startDate = null;
                doneDate = null;
            }
            else if ((action.actionType == 'updateCard') && ((action.newColumnId == implementationId) || (action.newColumnId == designId) || (action.newColumnId == verificationId))){
                if (!startDate) startDate = action.date;
            }
            else if ((action.actionType == 'updateCard') && (action.newColumnId == releaseReadyId)){
                doneDate = action.date;
            }
            else if ((action.actionType == 'createCard') && (action.newColumnId == releaseReadyId)){ //the case of a cards that were created in release ready!
                doneDate = action.date;
            }
        }

        if (!startDate) startDate = doneDate;
        return {startDate: startDate, doneDate: doneDate};
    }

    function compareSeriesCards(item1, item2){
        return (item1.doneDate > item2.doneDate ? 1: -1);
    }

    function getReleaseReadyActions(boardId) {
        var deferred = $.Deferred();
        var releaseReadyListId = -1;

        // Find the list id for the release ready
        Trello
            .get('boards/' + boardId + '/lists?fields=name')
            .success(function(queryResult) {
                $.each(queryResult, function(idx, list) {
                    if (list.name.indexOf('Release Ready') != -1)
                        releaseReadyListId = list.id;
                });

                // get all cards in the release ready list
                Trello
                    .get('lists/' + releaseReadyListId + '/cards?actions=createCard,updateCard,moveCardToBoard')
                    .success(function(cards) {
                        var state = $.map(cards, function(card, idx) {
                            var cardData = $.map(card.actions, function(cardAction, idxAction) {
                                if (cardAction.data.listBefore && (cardAction.type == 'updateCard')) { //by checking for both conditions we filter out updates that are not relatd to card moving
                                    return {date: moment(cardAction.date), newColumnId: cardAction.data.listAfter.id, newColumnName: cardAction.data.listAfter.name, actionType: cardAction.type  };
                                } else if (cardAction.data.list && (cardAction.type == 'createCard')){
                                    return {date: moment(cardAction.date), newColumnId: cardAction.data.list.id, newColumnName: cardAction.data.list.name, actionType: cardAction.type };
                                } else if (cardAction.type == 'moveCardToBoard') {
                                    return {date: moment(cardAction.date), actionType: cardAction.type  };
                                } else {
                                    return null;
                                }
                            });
                            return {name:card.name, id: card.id, actions: cardData};
                        });
                        deferred.resolve(state);
                    });
            });
        return deferred.promise();
    }

    function getFrequencySeries(cards){
        var series = new Array(cards.length);

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            // the +0.1 is to make the bar visible
            series[i] = [card.name, card.daysToComplete > 0 ?  card.daysToComplete : card.daysToComplete + 0.1];
        };

        //create the median series
        var median = getMedian(series.slice(0)); // we need to pass a copy because it gets modified inside that function
        var medianSeries = $.map(series, function(s, id) {return median});

        return [{
            data: series,
            name: 'User Stories'
        }, {
            data: medianSeries,
            type: 'line',
            name: 'Median',
            color: 'red',
            marker: { enabled: false }
        }];
    }

    function getMedian(values) {
        values.sort(function(a, b) {
            return a[1] - b[1];
        });

        var half = Math.floor(values.length/2);

        if (values.length % 2) {
            return values[half][1];
        } else {
            return (values[half - 1][1] + values[half][1]) / 2.0;
        }
    }

    function getAverage(cards) {
        var total = 0;

        $.each(cards, function(id, card){
            total += card.daysToComplete;
        })

        return Math.round(total/cards.length);
    }

    function getSizeColor(cardName){
        var storySize = getCardStoryUnits(cardName);
        switch(storySize) {
            case _storySize.small:
                return "green";
            case _storySize.medium:
                return "darkorange";
            case _storySize.large:
                return "red";
        }
    }

    function getVelocity(cards, metaData) {
        var storiesCompleted = cards.length;
        var averageStoriesPerWeek = 'N/A';
        var doneDate;

        var mvfDoneDate = metaData.meta.releasedOn
        var kickoffDate = metaData.meta.kickoffDate;

        var endDate = (mvfDoneDate.isValid() && moment() > mvfDoneDate) ? mvfDoneDate : moment();

        var daysPassed = getBusinessDaysDiff(kickoffDate, endDate);

        averageStoriesPerWeek = Math.round(storiesCompleted / (daysPassed * 0.2)); //crude approximation assuming each week day is 0.2 of a week

        return averageStoriesPerWeek;
    }

    function getBusinessDaysDiff(date1, date2){
        var currentDate = moment(date1);
        var days = 0;

        while(currentDate <= date2){
            if (isBusinessDay(currentDate))
                days++;

            currentDate.add('days', 1);
        }

        return days;
    }

    function drawFrequencyChart(cards, series, targetElement, metaData) {
        var chart;
        chart = new Highcharts.Chart({
            colors: ['black'],
            chart: {
                renderTo: targetElement,
                type: 'column',
            },
            title: { text: 'Cycle Time Chart' },
            xAxis: {
                categories: cards,
                lineWidth: 0,
                lineColor: '#999',
                title: { text: 'Date Completed On' },
                labels: {
                    useHTML: true,
                    formatter: function() {
                        var card = this.value;

                        if (!card.name)
                            return;

                        var linkColor;
                        var url = "https://trello.com/c/" + card.id;
                        return '<a href="' + url + '" target="_blank" style="text-decoration: none">' +
                               '<font color="' + getSizeColor(card.name) + '">' + card.doneDate.format("MM/DD") + '</font></a>';
                    }
                }
            },
            yAxis: {
                title: { text: 'Days to complete story' }
            },
            legend: {
                enabled: true,
                title: {
                    text: 'Average: ' + getAverage(cards) + 'days | Velocity (stories/week): ' + getVelocity(cards, metaData),
                    style: { fontWeight: 'normal' }
                }
            },
            tooltip: {
                hideDelay: 200,
                formatter: function() {
                    var y = (this.y == 0.1) ? 0 : this.y;
                    if (this.series.name == 'Median')
                        return "The Median is:" + y;
                    else
                        return this.key + " was completed on " + this.x.doneDate.format("M/D") + " in "  + y + " days";
                }
            },
            plotOptions: {
                column: {
                    shadow: false,
                    borderWidth: .5,
                    borderColor: '#666',
                    pointPadding: 0,
                    groupPadding: 0,
                    color: 'rgba(204,204,204,.85)',
                    pointWidth: 25
                },
            },
            series: series
        });
    }


    //************************************
    // CFD related functions
    //************************************

    function drawCfd(boardId, targetElement) {
        $.when(getMetadata(boardId), getLists(boardId), getCardData(boardId))
         .done(function(metaDataResult, listResult, cardDataResult) {
            onInitComplete($.extend(metaDataResult, listResult, cardDataResult, { targetElement: targetElement }));
         });
    }

    function getLists(boardId) {
        var deferred = $.Deferred();
        Trello
            .get('boards/' + boardId + '/lists')
            .success(function(queryResult) {
                var state = {};
                // get list of list names
                state.listNames = $.map(queryResult, function(list, idx) {
                    if (!isActiveCol(list))
                        return null;
                    return list.name;
                });

                // get map of list id => list name & create a collection of list name/id
                state.listMap = {};
                state.lists = [];
                $.each(queryResult, function(idx, list) {
                    if (!isActiveCol(list))
                        return null;
                    state.listMap[list.id] = list.name;
                    state.lists.push({listName: list.name, listId: list.id})
                });

                deferred.resolve(state);
            });
        return deferred.promise();
    }

    function getCardData(boardId) {
        var deferred = $.Deferred();
        var params = {
            actions: 'createCard,copyCard,updateCard:idList,moveCardFromBoard,moveCardToBoard,updateCard:closed'
        };

        Trello
            .get('boards/'+ boardId + '/cards/all', params)
            .success(function(queryResult) {
                var state = {};
                state.cards = queryResult;

                state.cardActions = $.map(queryResult, function(card, idx) {
                    return $.map(card.actions, function(cardAction, idxAction) {
                        if (cardAction.type === 'updateCard' && cardAction.data.listBefore) {
                            return { name: card.name, id: card.id, date: moment(cardAction.date), newColumn: cardAction.data.listAfter.id };
                        } else if (card.type === "createCard" || card.type === "copyCard" || card.type === "moveCardFromBoard" || card.type === "moveCardToBoard") {
                            return { name: card.name, id: card.id, date: moment(cardAction.date), newColumn: cardAction.data.list.id };
                        } else {
                            return null;
                        }
                    });
                });

                deferred.resolve(state);
            });

        return deferred.promise();
    }

    // Functions
    function onInitComplete(state) {
        var meta = state.meta;
        var cards = state.cards;
        var cardActions = state.cardActions;
        var listNames = state.listNames;
        var listMap = state.listMap;
        var categories, series, dates;

        // data points
        //categories = $.map(cardActions, function(cardAction, idx) { return cardAction.date; });
        dates = buildDateSeries(meta.kickoffDate, meta.releasedOn);
        categories = $.map(dates, function(date, idx) {
            return date.format('MM/DD');
        });

        var columnPointsMap = {};

        // populate all the series with zeroes
        $.each(listMap, function(id, name) {
            columnPointsMap[id] = $.map(new Array(dates.length), function() { return 0; });
        });

        // fill in each series, day by day, card by card
        for (var i = 0; i < dates.length; i++) {
            var date = dates[i];
            for (var j = 0; j < cards.length; j++) {
                var card = cards[j];
                if (card.ignored)
                    continue;
                var lastAction = getLastActionOfDay(card, date);

                if (!lastAction || !lastAction.newColumn || !listMap[lastAction.newColumn])
                    continue;

                if (lastAction.cardClosed) {
                    card.ignored = true;
                    continue;
                }

                var columnActions = columnPointsMap[lastAction.newColumn];
                columnActions[i] = columnActions[i] + 1;
            }
        }

        series = $.map(columnPointsMap, function(points, id) {
            return { name: listMap[id], data: points };
        }).sort(compareSeriesItems);

        doMagicChartOfDestiny(categories, series, state.targetElement);
    }

    function compareSeriesItems(item1, item2) {
        var getWeight = function(item) {
            if (item.name.indexOf('Analysis Complete') != -1) return 1;
            if (item.name.indexOf('Design') != -1) return 2;
            if (item.name.indexOf('Implementation') != -1) return 3;
            if (item.name.indexOf('Verification') != -1) return 4;
            if (item.name.indexOf('Release Ready') != -1) return 5;
        }

        var item1Weight = getWeight(item1);
        var item2Weight = getWeight(item2);

        if (item1Weight < item2Weight) return -1;
        if (item1Weight > item2Weight) return 1;

        return 0;
    }

    function isMatchingCardAction(cardAction) {
        return (cardAction.type === 'updateCard' && cardAction.data.listBefore)
            || (cardAction.type === 'createCard')
            || (cardAction.type === 'updateCard') && (cardAction.data.card && cardAction.data.card.closed)
            || (cardAction.type === 'copyCard')
            || (cardAction.type === 'moveCardFromBoard')
            || (cardAction.type === 'moveCardToBoard');
    }

    function getLastActionOfDay(card, date) {
        var ret = null;
        var nextDay = date.clone().add(1, 'days');

        for (var i = card.actions.length - 1; i >= 0; i--) {
            var cardAction = card.actions[i];
            if (isMatchingCardAction(cardAction) && moment(cardAction.date) < nextDay) {
                ret = cardAction;
            }
        }

        if (!ret) return null;

        if (ret.type === 'updateCard' && ret.data.listAfter && isActiveCol(ret.data.listAfter)) {
            return { name: card.name, id: card.id, date: moment(ret.date), newColumn: ret.data.listAfter.id, cardClosed: (ret.data.card ? ret.data.card.closed : false) };
        } else if (ret.type === 'updateCard' && ret.data.card.closed) {
            return { name: card.name, id: card.id, date: moment(ret.date), newColumn: null, cardClosed: true };
        } else if ((ret.type === 'createCard' && isActiveCol(ret.data.list)) || ret.type === "copyCard" || ret.type === "moveCardFromBoard" || ret.type === "moveCardToBoard")  {
            return { name: card.name, id: card.id, date: moment(ret.date), newColumn: ret.data.list.id, cardClosed: (ret.data.card ? ret.data.card.closed : false) };
        }
    }

    function doMagicChartOfDestiny(categories, series, targetElement) {
        var colors = [
            '#DB843D',
            '#4572A7',
            '#80699B',
            '#89A54E'
        ];

        if (series.length > 4) {
            colors.splice(1, 0, '#8895a3');
        }

        var chart;
        chart = new Highcharts.Chart({
            colors: colors,
            chart: {
                renderTo: targetElement,
                type: 'area'
            },
            title: {
                text: 'Tre-la-la CFD'
            },
            xAxis: {
                categories: categories,
                tickmarkPlacement: 'on',
                title: {
                    enabled: false
                }
            },
            yAxis: {
                title: {
                    text: 'Cards'
                }
            },
            tooltip: {
                formatter: function() {
                    return '' + this.x + ': ' + this.y;
                }
            },
            plotOptions: {
                area: {
                    stacking: 'normal',
                    lineColor: '#666666',
                    lineWidth: 0,
                    marker: {
                        lineWidth: 1,
                        lineColor: '#666666'
                    }
                }
            },
            series: series
        });
    }

    function buildDateSeries(startDate, releaseDate) {
        var series = [];
        var currentDate = startDate;
        var today = moment();
        var endDate = (!releaseDate || !releaseDate.isValid()) ? today : releaseDate
        while(currentDate <= endDate) {
            if (isBusinessDay(currentDate))
                series.push(currentDate);

            currentDate = currentDate.clone().add(1, 'day');
        }

        return series;
    }

    function extractMetadata(lists) {
        var confidence, kickoffDate, analysisCompleteDate, teamVelocity, releaseReadyDate, releasedOn;
        $.each(lists, function(ix, list) {
            if (list.name.indexOf('Meta') != -1) {
                $.each(list.cards, function(ix, card) {
                    var match = card.name.match(/^Confidence:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        confidence = match[1];
                    }

                    match = card.name.match(/^Kickoff\ Date:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        kickoffDate = match[1];
                    }

                    match = card.name.match(/^Analysis\ Complete\ Date:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        analysisCompleteDate = match[1];
                    }

                    match = card.name.match(/^Team\ Velocity\ \(Points\/Day\) ?:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        teamVelocity = match[1];
                    }

                    // This field is deprecated - renamed to "Target Date", keeping it here for
                    // backwards compatibility
                    match = card.name.match(/^Release\ Ready\ Date:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        releaseReadyDate = match[1];
                    }

                    // Replaced "Release Rasy Date"
                    match = card.name.match(/^Target\ Date:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        releaseReadyDate = match[1];
                    }

                    match = card.name.match(/^Released\ On:\ (.*)$/);
                    if (match != null && match.length >= 2) {
                        releasedOn = match[1];
                    }
                });
            }
        });

        return {
            meta: {
                confidence: confidence,
                kickoffDate: moment(kickoffDate),
                analysisCompleteDate: moment(analysisCompleteDate),
                teamVelocity: teamVelocity,
                releaseReadyDate: moment(releaseReadyDate),
                releasedOn: moment(releasedOn)
            }
        };
    }

    function getMetadata(boardId) {
        var deferred = $.Deferred();
        Trello
            .get('boards/' + boardId + '/lists?cards=open')
            .success(function(lists) {
                deferred.resolve(extractMetadata(lists));
            });
        return deferred.promise();
    }

    return {
        getBoardSummaryData: getBoardSummaryData,
        createPercentageCompleteChart: createPercentageCompleteChart,
        getScopeChangeHistory: getScopeChangeHistory,
        drawCfd: drawCfd,
        drawFrequency: drawFrequency
    };

})();


//********************************************
// jQuery Plugins
//********************************************

$.fn.trelalaBoardSummary = function(boardId) {
    var $this = this;
    Trelala.getBoardSummaryData(boardId).done(function(data) {
        completeId = $this.attr('id') + '-complete-' + boardId
        $this.html(
            '<table border=\'0\'>' +
                '<tr>' +
                    '<td id=\'' + completeId + '\' rowspan=\'4\'></td> ' +
                    '<td>Confidence: <b>' + data.confidence + '</b></td>' +
                    '<td width=\'5px\'></td>' +
                    '<td>Projected Date: <b>' + moment(data.projectedDoneDate).format("MM/DD/YYYY") + '</b></td> ' +
                    '<td width=\'5px\'></td>' +
                    '<td>Planned Story Units: <b>' + data.plannedStoryUnits + '</b></td> ' +
                '</tr>' +
                '<tr>' +
                    '<td>Percent Complete (Actual): <b>' + data.percentCompleteLabel + '</b></td>' +
                    '<td width=\'5px\'></td>' +
                    '<td>Kickoff Date: <b>' + data.kickoffDate + '</b></td> ' +
                    '<td width=\'5px\'></td>' +
                    '<td>Revised Story Units: <b>' + data.currentStoryUnits + '</b></td> ' +
                '</tr>' +
                '<tr>' +
                    '<td>&nbsp;</td>' +
                    '<td width=\'5px\'></td>' +
                    '<td>Target Date: <b>' + data.releaseReadyDate + '</b></td> ' +
                    '<td width=\'5px\'></td>' +
                    '<td>Story Units Complete: <b>' + data.storyUnitsComplete + '</b></td> ' +
                '</tr>' +
                '<tr>' +
                    '<td>&nbsp;</td>' +
                    '<td width=\'5px\'></td>' +
                    '<td>Released On: <b>' + data.releasedOn + '</b></td> ' +
                    '<td width=\'5px\'></td>' +
                    '<td>Total days in Blocked: <b><font ' + (data.totalBlockedDays > 0? 'color=red>': '>') + data.totalBlockedDays + '</font></b></td>' +
                '</tr>' +
            '</table>'
        );
        Trelala.createPercentageCompleteChart('#' + completeId, data.percentComplete, 100);
    });
    return this;
};

$.fn.trelalaBoardDashboardSummary = function(boardId) {
    var $this = this;
    Trelala.getBoardSummaryData(boardId).done(function(data) {
        completeId = $this.attr('id') + '-complete-' + boardId
        $this.html(
            '<table>' +
                '<tr>' +
                    '<td id=\'' + completeId + '\'></td> ' +
                    '<td>' +
                        '<div>Confidence: <b>' + data.confidence + '</b></div>' +
                        '<div>Projected Date: <b>' + moment(data.projectedDoneDate).format("MM/DD/YYYY") + '</b></div>' +
                        '<div>Target Date: <b>' + data.releaseReadyDate + '</b></div>' +
                    '</td>' +
                '</tr>' +
            '</table>'
        );
        Trelala.createPercentageCompleteChart('#' + completeId, data.percentComplete, 100);
    });
    return this;
};

$.fn.trelalaBoardScopeChangeHistory = function(boardId) {
    this.html(Trelala.getScopeChangeHistory(boardId));
    return this;
};

$.fn.trelalaBoardCfd = function(boardId) {
    Trelala.drawCfd(boardId, this.attr('id'));
    return this;
};

$.fn.trelalaBoardFrequencyChard = function(boardId) {
    Trelala.drawFrequency(boardId, this.attr('id'));
    return this;
};
